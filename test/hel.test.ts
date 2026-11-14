// Perséphone (hel) : récupération de partitions perdues et de fichiers effacés, sur un VRAI Odin (interface web démarrée).
// Le support est une vraie image disque (GPT, une partition FAT16 « PHOTOS » où des fichiers ont été copiés puis
// effacés avec mtools, une partition ext4), fabriquée avec sfdisk, mkfs.vfat, mtools et mkfs.ext4 puis compressée :
// test/fixtures/hel/disque-gpt.img.gz. Les originaux des fichiers sont dans test/fixtures/hel/fichiers/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { attendreHel } from '../src/valhalla/modules/hel.ts';
import { ouvrir } from '../src/valhalla/hel/support.ts';
import { lireTable } from '../src/valhalla/hel/tables.ts';

const FX = join(import.meta.dirname, 'fixtures', 'hel'), ORIG = join(FX, 'fichiers');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const empreinte = (f: string) => sha(readFileSync(f));
type R = { ok?: boolean; text?: string; confirm?: string; data?: Record<string, unknown> };
const acte = async (v: VraiOdin, action: string, input: Record<string, unknown> = {}, confirm = false) => (await v.json('/api/valhalla/act', { module: 'hel', action, input, ...(confirm ? { confirm: true } : {}) })).body as R;
async function attendre(): Promise<void> { const va = valhallaOf()!; await attendreHel(va.ctx('hel').dir); }
/** Efface des secteurs d'une image (pour « perdre » une table). */
function effacer(img: string, zones: Array<[number, number]>): void { const fd = openSync(img, 'r+'); try { for (const [pos, n] of zones) writeSync(fd, Buffer.alloc(n), 0, n, pos); } finally { closeSync(fd); } }

test('Perséphone : fichiers effacés retrouvés avec leur nom (FAT) et par signature, comparés octet par octet ; la source n\'est jamais modifiée', { timeout: 180_000 }, async () => {
  const tt = new T();
  try {
    const v = await vraiOdin(tt, { compte: true }), va = valhallaOf()!, dir = tt.tmp("hel-");
    const img = join(dir, 'support', 'carte.img'), dest = join(dir, 'autre-disque'); mkdirSync(join(dir, 'support')); mkdirSync(dest);
    writeFileSync(img, gunzipSync(readFileSync(join(FX, 'disque-gpt.img.gz'))));
    const avant = empreinte(img);

    // 1. Choisir le support : sa table est lue (GPT, FAT16 « PHOTOS », ext4 « linux »).
    let r = await acte(v, 'ouvrir', { disque: img });
    assert.equal(r.ok, true, r.text); assert.match(r.text!, /table GPT · 2 partition/); assert.match(r.text!, /FAT16 « PHOTOS »/); assert.match(r.text!, /ext4 \(Linux\) « linux »/);
    assert.match(r.text!, /N'écris plus rien sur ce support/);

    // 2. Ranger « dans » l'image elle-même, ou nulle part : refusé.
    r = await acte(v, 'recuperer', { destination: img });
    assert.equal(r.ok, false); assert.match(r.text!, /Je refuse de ranger là : .* n'est pas un dossier : c'est le support lui-même/);
    r = await acte(v, 'recuperer', {}); assert.equal(r.ok, false); assert.match(r.text!, /Dis-moi où ranger/);
    r = await acte(v, 'recuperer', { destination: join(dir, 'existe-pas') }); assert.equal(r.ok, false); assert.match(r.text!, /n'existe pas/);

    // 3. Lancer, sur un autre dossier : tâche de fond, puis rapport.
    r = await acte(v, 'recuperer', { destination: dest });
    assert.notEqual(r.ok, false, r.text); assert.match(r.text!, /Récupération lancée/);
    const occupe = await acte(v, 'recuperer', { destination: dest }); assert.ok(occupe.ok === false || /lancée/.test(occupe.text!), 'un seul travail à la fois (ou déjà fini)');
    await attendre();
    const rec = join(dest, 'recuperes');
    // Les fichiers effacés de la FAT, avec leur nom et leur dossier, identiques aux originaux. Un nom court (8.3) effacé
    // perd sa première lettre (la FAT la remplace par la marque « effacé ») : elle revient en « _ » ; un nom long est entier.
    for (const [f, nom, fam] of [['photo.jpg', '_hoto.jpg', 'photos'], ['doc.pdf', '_oc.pdf', 'documents'], ['video.mp4', '_ideo.mp4', 'videos'], ['texte.docx', 'texte.docx', 'documents']] as const) {
      const p = join(rec, fam, 'DCIM', nom);
      assert.ok(existsSync(p), `${f} retrouvé avec son nom (${readdirSync(join(rec, fam)).join(', ')})`);
      assert.equal(empreinte(p), empreinte(join(ORIG, f)), `${f} identique à l'original`);
    }
    // Ceux qui n'étaient pas effacés sont aussi retrouvés par leur signature (même contenu).
    const tous = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tous(join(d, e.name)) : [join(d, e.name)]));
    const sommes = new Set(tous(rec).filter((f) => !f.endsWith('.txt')).map(empreinte));
    for (const f of ['image.png', 'archive.zip']) assert.ok(sommes.has(empreinte(join(ORIG, f))), `${f} retrouvé par signature`);
    assert.ok(tous(rec).some((f) => /rapport-.*\.txt$/.test(f)), 'rapport détaillé écrit à côté');
    assert.equal(empreinte(img), avant, 'la source n\'a pas changé d\'un octet');

    // Le rapport, l'alerte dans le fil commun (avec le bouton vers l'antivirus), la page.
    r = await acte(v, 'resultats'); assert.match(r.text!, /fichier\(s\) retrouvé\(s\) depuis/); assert.match(r.text!, /Tout n'est pas forcément retrouvable/);
    const al = va.alerts({ module: 'hel' }).find((a) => /Perséphone : \d+ fichier\(s\) retrouvé\(s\)/.test(a.title));
    assert.ok(al, 'alerte dans le fil commun'); assert.deepEqual({ m: al!.fix?.module, a: al!.fix?.action }, { m: 'hel', a: 'analyser' });
    const vue = await va.module('hel')!.view(va.ctx('hel'), new URLSearchParams());
    assert.deepEqual(vue.onglets, ['Récupérer', 'Partitions', 'Résultats']);
    assert.ok(vue.sections.every((x) => !x.onglet || vue.onglets!.includes(x.onglet)));
    const liste = vue.sections.find((x) => x.kind === 'list' && x.title === 'Fichiers retrouvés') as Extract<(typeof vue.sections)[number], { kind: 'list' }>;
    const photo = liste.items.find((x) => x.title === 'photos/DCIM/_hoto.jpg'); assert.ok(photo?.fichier, 'chaque fichier se télécharge depuis la page');
    // Télécharger un fichier retrouvé depuis l'appareil : seulement ceux du dossier de la récupération.
    const dl = await fetch(`${v.url}/api/valhalla/fichier?module=hel&ref=${encodeURIComponent(photo!.fichier!.ref)}`, { headers: { cookie: v.session } });
    assert.equal(dl.status, 200); assert.equal(sha(Buffer.from(await dl.arrayBuffer())), empreinte(join(ORIG, 'photo.jpg')));
    const id = photo!.fichier!.ref.split('/')[0];
    for (const ref of [`${id}/../../../../etc/passwd`, `${id}/../rapport.json`, 'inconnu/photos/x.jpg', '/etc/passwd']) assert.equal((await fetch(`${v.url}/api/valhalla/fichier?module=hel&ref=${encodeURIComponent(ref)}`, { headers: { cookie: v.session } })).status, 404, ref);

    // Lien vers l'antivirus : le dossier retrouvé est analysé par Asclépios.
    r = await acte(v, 'analyser'); assert.match(r.text!, /fichiers analysés/);
  } finally { await tt.end(); }
});

test('Perséphone : table effacée, partitions retrouvées, table réparée avec copie de secours, puis remise comme avant (octet par octet)', { timeout: 180_000 }, async () => {
  const tt = new T();
  try {
    const v = await vraiOdin(tt, { compte: true }), dir = tt.tmp("hel-"), img = join(dir, 'disque.img'), orig = gunzipSync(readFileSync(join(FX, 'disque-gpt.img.gz')));
    writeFileSync(img, orig);
    const taille = orig.length;
    // La table GPT perdue : les deux copies (début et fin) effacées.
    effacer(img, [[0, 34 * 512], [taille - 33 * 512, 33 * 512]]);
    const efface = empreinte(img);
    let r = await acte(v, 'table', { source: img }); assert.match(r.text!, /pas de table de partitions/);
    r = await acte(v, 'proposer', { source: img }); assert.equal(r.ok, false); assert.match(r.text!, /Lance d'abord « Chercher les partitions perdues »/);

    r = await acte(v, 'chercher', { source: img, profondeur: 'complète' }); assert.match(r.text!, /Recherche complète des partitions lancée/);
    await attendre();
    assert.equal(empreinte(img), efface, 'chercher ne modifie rien');
    r = await acte(v, 'proposer', { source: img });
    assert.notEqual(r.ok, false, r.text); assert.match(r.text!, /Table GPT proposée/); assert.match(r.text!, /2 partition\(s\) retrouvée\(s\)/); assert.match(r.text!, /Rien n'est écrit/);
    assert.equal(empreinte(img), efface, 'proposer ne modifie rien');

    // Réparer : action grave, accord demandé ; rien d'écrit sans.
    r = await acte(v, 'reparer', { source: img }); assert.match(r.confirm ?? '', /Confirmer : écrire une nouvelle table de partitions/); assert.equal(empreinte(img), efface);
    r = await acte(v, 'reparer', { source: img }, true); assert.notEqual(r.ok, false, r.text); assert.match(r.text!, /Table GPT écrite/);
    const secours = (r.data as { secours: string }).secours; assert.ok(secours);
    const s = await ouvrir(img); const t = await lireTable(s); await s.fermer();
    assert.equal(t.genre, 'gpt'); assert.ok(t.gpt.principal.enteteJuste && t.gpt.secours.enteteJuste, 'les deux copies GPT sont justes');
    assert.deepEqual(t.partitions.map((p) => [p.debut, p.secteurs]), [[2048, 14336], [16384, 14336]], 'les partitions sont revenues à leur place');
    // Seuls les secteurs de la table ont changé : le contenu des partitions est intact.
    const apres = readFileSync(img);
    assert.ok(apres.subarray(34 * 512, taille - 33 * 512).equals(orig.subarray(34 * 512, taille - 33 * 512)), 'contenu des partitions intact');
    // La copie de secours est rangée dans les données de Perséphone, pas sur le support.
    const va = valhallaOf()!, rep = join(va.ctx('hel').dir, 'secours', secours);
    assert.ok(existsSync(join(rep, 'debut.bin')) && existsSync(join(rep, 'fin.bin')));

    // Remettre la table d'avant : l'image revient exactement à son état d'avant la réparation.
    r = await acte(v, 'remettre', { id: secours }); assert.match(r.confirm ?? '', /Confirmer/);
    r = await acte(v, 'remettre', { id: secours }, true); assert.match(r.text!, /est revenu comme avant/);
    assert.equal(empreinte(img), efface, 'octet pour octet comme avant la réparation');
    r = await acte(v, 'remettre', { id: '../../etc' }, true); assert.equal(r.ok, false);

    // Une seule copie GPT abîmée (l'en-tête du début) : l'autre est intacte, on la recopie à l'identique.
    writeFileSync(img, orig); effacer(img, [[512, 512]]);
    r = await acte(v, 'proposer', { source: img }); assert.match(r.text!, /copie de secours \(à la fin\) de la table GPT est intacte/);
    r = await acte(v, 'reparer', { source: img }, true); assert.match(r.text!, /Table GPT écrite/);
    const s2 = await ouvrir(img); const t2 = await lireTable(s2); await s2.fermer();
    assert.ok(t2.gpt.principal.enteteJuste && t2.gpt.principal.entreesJustes); assert.deepEqual(t2.partitions.map((p) => p.nom), ['photos', 'linux'], 'mêmes partitions, mêmes noms');
    assert.ok(readFileSync(img).subarray(512, 1024).equals(orig.subarray(512, 1024)), 'en-tête refait à l\'identique de l\'original');
  } finally { await tt.end(); }
});

test('Perséphone : un fichier coupé est rangé dans « abîmés », et une récupération s\'arrête quand on le demande', { timeout: 180_000 }, async () => {
  const tt = new T();
  try {
    const v = await vraiOdin(tt, { compte: true }), dir = tt.tmp("hel-"), img = join(dir, 'brut.img'), dest = join(dir, 'dest'); mkdirSync(dest);
    // Un support sans système de fichiers : du bruit, une photo entière, une photo coupée en deux suivie de zéros.
    const jpg = readFileSync(join(ORIG, 'photo.jpg')), png = readFileSync(join(ORIG, 'image.png'));
    const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((4096 - (b.length % 4096)) % 4096)]);
    writeFileSync(img, Buffer.concat([randomBytes(8192), pad(jpg), randomBytes(4096), pad(png), Buffer.alloc(4096), pad(jpg.subarray(0, 8192)), Buffer.alloc(65536)]));
    let r = await acte(v, 'recuperer', { source: img, destination: dest, familles: 'photos' }); assert.match(r.text!, /lancée/);
    await attendre();
    const ph = join(dest, 'recuperes', 'photos');
    const entiers = readdirSync(ph).filter((f) => f.endsWith('.jpg') || f.endsWith('.png')), abimes = readdirSync(join(ph, 'abîmés'));
    assert.ok(entiers.some((f) => empreinte(join(ph, f)) === sha(jpg)), 'la photo entière est identique');
    assert.ok(entiers.some((f) => empreinte(join(ph, f)) === sha(png)), 'le PNG entier est identique');
    assert.equal(abimes.length, 1, `la photo coupée est signalée abîmée (${abimes.join(', ')})`);
    r = await acte(v, 'resultats'); assert.match(r.text!, /1 abîmé/);

    // Arrêt en cours de route : un gros support (vide), arrêté presque tout de suite ; le rapport le dit.
    const gros = join(dir, 'gros.img'); writeFileSync(gros, Buffer.alloc(0)); const fd = openSync(gros, 'r+'); writeSync(fd, Buffer.from([1]), 0, 1, 1024 * 1024 * 1024 - 1); closeSync(fd);
    r = await acte(v, 'recuperer', { source: gros, destination: dest }); assert.match(r.text!, /lancée/);
    r = await acte(v, 'arreter'); assert.match(r.text!, /Récupération arrêtée/);
    await attendre();
    r = await acte(v, 'resultats'); assert.match(r.text!, /arrêtée avant la fin/);
    r = await acte(v, 'arreter'); assert.match(r.text!, /Rien n'est en cours/);
  } finally { await tt.end(); }
});

test('Perséphone sans IA : les phrases de récupération arrivent chez elle, les phrases banales non', { timeout: 60_000 }, async () => {
  const tt = new T();
  try {
    const v = await vraiOdin(tt, { compte: true });
    const dire = async (text: string) => (await v.json('/api/valhalla/order', { text })).body as { module?: string; text?: string; kind?: string };
    for (const t of ['retrouve mes photos effacées sur la clé', 'partitions perdues', 'cherche les partitions perdues', 'récupère les fichiers effacés', 'arrête la récupération', 'fichiers retrouvés']) assert.equal((await dire(t)).module, 'hel', t);
    for (const t of ['efface mes photos', 'récupère les mises à jour du dépôt', 'montre mes photos de vacances', 'la clé du coffre', 'mes fichiers', 'supprime le fichier rapport.pdf']) assert.notEqual((await dire(t)).module, 'hel', t);
  } finally { await tt.end(); }
});
