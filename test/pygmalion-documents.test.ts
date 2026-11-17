// Pygmalion — lot 2 : fabriquer des fichiers et des documents écrits dans Odin, RELUS par les lecteurs d'Odin déjà là
// (aller-retour), bien formés, sûrs (aucune formule ni balise venue d'un texte extérieur, aucun chemin qui sort, aucune
// donnée personnelle dans les propriétés), et des archives zip / tar.gz qui se rouvrent à l'identique — les piégées
// étant refusées.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, userInfo, hostname } from 'node:os';
import { join } from 'node:path';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { Pygmalion } from '../src/valhalla/pygmalion/moteur.ts';
import { fabriquer } from '../src/valhalla/pygmalion/documents.ts';
import { formuleSure, ecrireCsv } from '../src/valhalla/pygmalion/tableur.ts';
import { creerZip, creerTarGz, ouvrirArchive, nomEntreeSur } from '../src/valhalla/pygmalion/archives.ts';
import { MODELES, remplir } from '../src/valhalla/pygmalion/modeles.ts';
import { readDocx, readXlsx, readPptx, parseCsv } from '../src/files/office.ts';
import { extractPdfText } from '../src/files/pdf.ts';
import { unzip, zip } from '../src/files/zip.ts';
import { lireTar } from '../src/files/tar-flux.ts';
import { lireOdf, lireRtf, lireHtml } from '../src/valhalla/theia/documents.ts';
import type { DemandeDocument } from '../src/valhalla/pygmalion/types.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const T0 = new Date(2026, 10, 17, 10, 0).getTime();
function monter() {
  const home = mkdtempSync(join(tmpdir(), 'pygmalion-doc-')); dossiers.push(home);
  return { home, p: new Pygmalion({ home, dir: join(home, 'pyg'), sortie: join(home, 'sortie'), maintenant: () => T0 }) };
}
const TEXTE = '# Le compost\n\nUn **bon** compost mélange le *vert* et le brun : épluchures, feuilles, carton.\n\n- arroser un peu\n- retourner chaque mois\n\nPrêt en six mois, à 20 °C environ.';
const mesures: string[] = [];

test('Word, PowerPoint, PDF, OpenDocument texte et présentation, RTF, HTML, Markdown, texte : relus justes (aller-retour)', () => {
  const { p } = monter();
  const fab = (d: DemandeDocument) => { const t0 = performance.now(); const c = p.produire(d); mesures.push(`${d.format} ${c.octets} o en ${(performance.now() - t0).toFixed(1)} ms`); return p.octetsDe(c); };
  const docx = readDocx(fab({ format: 'docx', titre: 'Fiche compost', texte: TEXTE }));
  assert.match(docx, /Fiche compost/); assert.match(docx, /Un bon compost mélange le vert et le brun/); assert.match(docx, /retourner chaque mois/); assert.match(docx, /Création d'Odin/);
  const pptx = readPptx(fab({ format: 'pptx', titre: 'Compost', diapositives: [{ titre: 'Pourquoi', puces: ['moins de déchets', 'un sol vivant'] }, { titre: 'Comment', puces: ['vert + brun'] }] }));
  assert.match(pptx, /Pourquoi[\s\S]*moins de déchets[\s\S]*un sol vivant[\s\S]*Comment[\s\S]*vert \+ brun[\s\S]*Création d'Odin/);
  const pdf = extractPdfText(fab({ format: 'pdf', titre: 'Fiche compost', texte: TEXTE }));
  assert.match(pdf, /Fiche compost/); assert.match(pdf, /bon compost m.lange le vert/); assert.match(pdf, /Création d'Odin/);
  const odt = lireOdf(fab({ format: 'odt', titre: 'Fiche compost', texte: TEXTE }), 'odt');
  assert.equal(odt.lu, true);
  assert.deepEqual(odt.blocs.filter((b) => b.type === 'titre').map((b) => b.texte), ['Fiche compost', 'Le compost']);
  assert.deepEqual(odt.blocs.find((b) => b.type === 'liste')?.items, ['arroser un peu', 'retourner chaque mois']);
  assert.match(odt.texte, /Un bon compost mélange le vert et le brun/);
  const odp = lireOdf(fab({ format: 'odp', titre: 'Compost', diapositives: [{ titre: 'Pourquoi', puces: ['moins de déchets'] }] }), 'odp');
  assert.match(odp.texte, /Pourquoi[\s\S]*moins de déchets[\s\S]*Création d'Odin/);
  const rtf = lireRtf(fab({ format: 'rtf', titre: 'Fiche compost', texte: TEXTE }));
  assert.match(rtf.texte, /Fiche compost/); assert.match(rtf.texte, /Un bon compost mélange le vert et le brun : épluchures/); assert.match(rtf.texte, /20 °C/);
  const html = lireHtml(fab({ format: 'html', titre: 'Fiche compost', texte: TEXTE }));
  assert.match(html.texte, /Un bon compost mélange le vert et le brun/); assert.match(html.texte, /Création d'Odin/);
  const md = fab({ format: 'md', titre: 'Fiche compost', texte: TEXTE }).toString('utf8');
  assert.ok(md.startsWith('# Fiche compost\n') && md.includes(TEXTE) && md.includes('Création d\'Odin'));
  console.log(`# mesuré : ${mesures.join(' · ')}`);
});

test('bien formés : types déclarés, « mimetype » rangé en premier et sans compression, fins de fichier', () => {
  const m = (d: DemandeDocument) => fabriquer(d, 'Création d\'Odin').octets;
  const odt = m({ format: 'odt', titre: 't', texte: 'x' });
  assert.equal(odt.subarray(30, 38).toString('ascii'), 'mimetype', 'première entrée « mimetype »');
  assert.equal(odt.readUInt16LE(8), 0, 'rangée sans compression');
  assert.match(odt.subarray(38, 38 + 39).toString('ascii'), /^application\/vnd\.oasis\.opendocument\.text/);
  for (const f of ['docx', 'xlsx', 'pptx'] as const) {
    const z = unzip(m({ format: f, titre: 't', texte: 'x' }));
    assert.ok(z.has('[Content_Types].xml') && z.has('_rels/.rels'), f);
  }
  const pdf = m({ format: 'pdf', titre: 't', texte: 'x' }).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-') && /%%EOF\s*$/.test(pdf), 'PDF commencé et terminé');
  assert.match(m({ format: 'html', titre: 't', texte: 'x' }).toString(), /^<!doctype html>[\s\S]*<\/html>\n$/);
  assert.match(m({ format: 'xml', titre: 't', donnees: { a: 1 } }).toString(), /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(m({ format: 'rtf', titre: 't', texte: 'x' }).toString(), /^\{\\rtf1[\s\S]*\}$/);
});

test('tableurs : nombres, booléens, formules voulues relus ; un texte qui commence par « = » reste un TEXTE', () => {
  const { p } = monter();
  const lignes = [['Article', 'Prix', 'Payé'], ['Pain', 2.5, true], ['Lait', 1.2, false], ['=HYPERLINK("http://x","clic")', 3, false], ['Total', { formule: 'SUM(B2:B4)' }, null]];
  const x = readXlsx(p.octetsDe(p.produire({ format: 'xlsx', titre: 'Courses', feuilles: [{ nom: 'Courses', lignes }] })));
  assert.deepEqual(x[0].rows[1], ['Pain', '2.5', 'VRAI']);
  assert.equal(x[0].rows[3][0], '=HYPERLINK("http://x","clic")', 'relu comme texte');
  assert.equal(x[0].rows[4][1], '=SUM(B2:B4)', 'la formule voulue est une formule');
  assert.equal(x[1].name, 'Création d\'Odin');
  const raw = unzip(p.octetsDe(p.registre.liste().map((c) => c).find((c) => c.format === 'xlsx')!)).get('xl/worksheets/sheet1.xml')!.toString();
  assert.match(raw, /<c r="A4" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/, 'stocké en texte, pas en <f>');
  assert.equal((raw.match(/<f>/g) ?? []).length, 1, 'une seule formule : celle demandée');
  // ODS : même chose
  const ods = p.octetsDe(p.produire({ format: 'ods', titre: 'Courses', feuilles: [{ nom: 'Courses', lignes }] }));
  const contenu = unzip(ods).get('content.xml')!.toString();
  assert.match(contenu, /table:formula="of:=SUM\(\[\.B2:\.B4\]\)"/);
  assert.equal((contenu.match(/table:formula=/g) ?? []).length, 1);
  assert.deepEqual(lireOdf(ods, 'ods').blocs.find((b) => b.type === 'tableau')?.lignes?.[3]?.[0], '=HYPERLINK("http://x","clic")');
});

test('formules : seules les fonctions de calcul d\'une liste blanche ; liens, appels externes, commandes refusés', () => {
  for (const ok of ['SUM(A1:A3)', '=AVERAGE(B2:B9)*2', 'IF(A1>3,1,0)', 'ROUND($A$1/3,2)']) assert.ok(formuleSure(ok), ok);
  for (const ko of ['HYPERLINK("http://x")', 'WEBSERVICE("http://x")', 'cmd|\'/c calc\'!A1', 'INDIRECT(A1)', 'SUM(A1:A3)+"x"', 'DDE("x")', 'A1&B1']) assert.throws(() => formuleSure(ko), /refusée/, ko);
});

test('CSV : les débuts dangereux reçoivent une apostrophe ; relu juste', () => {
  const csv = ecrireCsv([['nom', 'note'], ['=1+1', '+33'], ['@SUM(A1)', '-2'], ['a;b', 'il a dit "oui"'], [5, { formule: 'SUM(A1:A2)' }]]);
  const l = parseCsv(csv.replace(/\r/g, ''));
  assert.deepEqual(l[1], ['\'=1+1', '\'+33']);
  assert.deepEqual(l[2], ['\'@SUM(A1)', '\'-2']);
  assert.deepEqual(l[3], ['a;b', 'il a dit "oui"']);
  assert.deepEqual(l[4], ['5', '\'=SUM(A1:A2)'], 'même une formule demandée reste du texte en CSV');
});

test('HTML et XML : rien d\'un texte extérieur ne devient une balise, un script ou une entité', () => {
  const m = (d: DemandeDocument) => fabriquer(d, 'Création d\'Odin').octets.toString('utf8');
  const h = m({ format: 'html', titre: '<script>alert(1)</script>', texte: 'clic <img src=x onerror=alert(1)> **gras**' });
  assert.doesNotMatch(h, /<script>alert|<img/); assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.match(h, /<strong>gras<\/strong>/);
  assert.match(h, /Content-Security-Policy" content="default-src 'none'/);
  const x = m({ format: 'xml', titre: 't', donnees: { '<b>': '<!ENTITY x SYSTEM "file:///c:/x">', liste: [1, 2], 'xml-nom': '&amp;' } });
  assert.doesNotMatch(x, /<!DOCTYPE|<!ENTITY/); assert.match(x, /<_b_>&lt;!ENTITY/); assert.match(x, /<liste>1<\/liste>\n\s*<liste>2<\/liste>/); assert.match(x, /<_xml-nom>&amp;amp;<\/_xml-nom>/);
  const r = m({ format: 'rtf', titre: 't', texte: '{\\field{\\*\\fldinst HYPERLINK "http://x"}}' });
  assert.doesNotMatch(r, /\{\\field/); assert.match(r, /\\\{\\\\field/);
});

test('aucune donnée personnelle dans les fichiers (nom de l\'utilisateur, nom de la machine, dossiers)', () => {
  const { p, home } = monter();
  const u = userInfo().username, h = hostname();
  for (const format of ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'pdf', 'html', 'xml', 'rtf', 'md', 'txt', 'json', 'csv'] as const) {
    const c = p.produire({ format, titre: `Essai ${format}`, texte: 'contenu ordinaire', feuilles: [{ nom: 'a', lignes: [['x']] }], donnees: { a: 1 } });
    const octets = p.octetsDe(c);
    const tout = [octets.toString('latin1'), ...(format.match(/^(docx|xlsx|pptx|odt|ods|odp)$/) ? [...unzip(octets).values()].map((b) => b.toString('utf8')) : [])].join('\n');
    for (const secret of [u, h, home]) if (secret.length > 2) assert.ok(!tout.toLowerCase().includes(secret.toLowerCase()), `${format} contient « ${secret} »`);
  }
});

test('modèles réutilisables : courrier, tableau, fiche ; une valeur n\'est jamais relue comme un gabarit', () => {
  const { p } = monter();
  assert.equal(remplir('Bonjour {{nom}}, {{inconnu}}', { nom: '{{secret}}' }), 'Bonjour {{secret}}, [inconnu ?]');
  const c = p.depuisModele('courrier', { expediteur: 'A. Ali', destinataire: 'Service client', lieu: 'Mamoudzou', date: '17/11/2026', objet: 'Résiliation', corps: 'Je résilie mon abonnement.', signature: 'A. Ali' }, 'odt');
  const t = lireOdf(p.octetsDe(c), 'odt').texte;
  assert.match(t, /Mamoudzou, le 17\/11\/2026[\s\S]*Objet : Résiliation[\s\S]*Je résilie mon abonnement/);
  assert.deepEqual(c.sources, [{ genre: 'modele', detail: 'modèle « Courrier »' }]);
  const tab = p.depuisModele('tableau', { titre: 'Suivi', colonnes: 'Tâche;État', lignes: 'Peindre;=fait\nRanger;à faire' }, 'xlsx');
  assert.deepEqual(readXlsx(p.octetsDe(tab))[0].rows, [['Tâche', 'État'], ['Peindre', '=fait'], ['Ranger', 'à faire']]);
  assert.throws(() => p.depuisModele('courrier', {}, 'xlsx'), /ne se fait pas/);
  assert.equal(MODELES.length, 3);
});

test('archives zip et tar.gz : créées puis rouvertes à l\'identique (et par le lecteur tar d\'Odin)', async () => {
  const { p } = monter();
  const fichiers = [{ nom: 'notes/a.txt', octets: Buffer.from('première note') }, { nom: 'notes/b.bin', octets: Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251)) }, { nom: 'liste.md', octets: Buffer.from('# Liste\n- un\n') }];
  for (const genre of ['zip', 'tar.gz'] as const) {
    const t0 = performance.now();
    const c = p.archiver(fichiers, genre, `Sauvegarde ${genre}`);
    const relu = p.lireArchive(p.octetsDe(c), genre);
    assert.deepEqual(relu.map((f) => [f.nom, f.octets.toString('hex')]).sort(), fichiers.map((f) => [f.nom, f.octets.toString('hex')]).sort(), genre);
    assert.equal(c.marque, 'au registre');
    mesures.push(`${genre} ${c.octets} o en ${(performance.now() - t0).toFixed(1)} ms`);
    const o = p.ouvrir(p.octetsDe(c), genre, `ouvert ${genre}`);
    assert.deepEqual(o.fichiers.sort(), fichiers.map((f) => f.nom).sort());
    assert.throws(() => p.ouvrir(p.octetsDe(c), genre, `ouvert ${genre}`), /existe déjà/, 'jamais écraser');
  }
  console.log(`# mesuré : ${mesures.filter((m) => /^(zip|tar)/.test(m)).join(' · ')}`);
  const { gunzipSync } = await import('node:zlib');
  const tar = gunzipSync(creerTarGz(fichiers));
  const vus: string[] = [];
  for await (const e of lireTar(Readable.from([tar]))) vus.push(`${e.nom}:${e.data?.length}`);
  assert.deepEqual(vus.sort(), ['liste.md:13', 'notes/a.txt:14', 'notes/b.bin:5000']);
});

/** Un zip fabriqué à la main (pour les pièges que l'écrivain refuse de produire). */
function zipBrut(entrees: Array<{ nom: string; data: Buffer; usize?: number; attrs?: number; deflate?: boolean }>): Buffer {
  const locaux: Buffer[] = [], centraux: Buffer[] = [];
  let off = 0;
  for (const e of entrees) {
    const nom = Buffer.from(e.nom), comp = e.deflate ? deflateRawSync(e.data) : e.data;
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(e.deflate ? 8 : 0, 8); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(e.usize ?? e.data.length, 22); l.writeUInt16LE(nom.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 6); c.writeUInt16LE(e.deflate ? 8 : 0, 10); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(e.usize ?? e.data.length, 24); c.writeUInt16LE(nom.length, 28); c.writeUInt32LE(e.attrs ?? 0, 38); c.writeUInt32LE(off, 42);
    locaux.push(l, nom, comp); centraux.push(c, nom); off += 30 + nom.length + comp.length;
  }
  const cd = Buffer.concat(centraux), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entrees.length, 8); fin.writeUInt16LE(entrees.length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(off, 16);
  return Buffer.concat([...locaux, cd, fin]);
}
/** Un tar fabriqué à la main avec un type et un nom au choix. */
function tarBrut(nom: string, type: string, data = Buffer.from('x'), lien = ''): Buffer {
  const h = Buffer.alloc(512); h.write(nom, 0, 100); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116); h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124); h.write('00000000000\0', 136); h.write('        ', 148); h.write(type, 156); h.write(lien, 157, 100); h.write('ustar\0', 257); h.write('00', 263);
  let s = 0; for (const x of h) s += x; h.write(`${s.toString(8).padStart(6, '0')}\0 `, 148);
  return gzipSync(Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512), Buffer.alloc(1024)]));
}

test('archives piégées refusées AVANT toute écriture : « .. », absolu, barre inverse, nom réservé, lien, bombe, taille menteuse', () => {
  const { p, home } = monter();
  const pieges: Array<[string, Buffer, 'zip' | 'tar.gz', RegExp]> = [
    ['zip « .. »', zipBrut([{ nom: '../../evade.txt', data: Buffer.from('x') }]), 'zip', /sort ou tourne en rond/],
    ['zip absolu', zipBrut([{ nom: '/etc/evade', data: Buffer.from('x') }]), 'zip', /absolu/],
    ['zip lecteur', zipBrut([{ nom: 'C:/Windows/evade', data: Buffer.from('x') }]), 'zip', /absolu/],
    ['zip barre inverse', zipBrut([{ nom: '..\\evade.txt', data: Buffer.from('x') }]), 'zip', /barre inverse/],
    ['zip nom réservé', zipBrut([{ nom: 'dossier/CON.txt', data: Buffer.from('x') }]), 'zip', /impossible sous Windows/],
    ['zip lien symbolique', zipBrut([{ nom: 'lien', data: Buffer.from('/etc/passwd'), attrs: (0o120777 << 16) >>> 0 }]), 'zip', /lien symbolique/],
    ['zip bombe', zipBrut([{ nom: 'zeros.bin', data: Buffer.alloc(150 * 1024 * 1024), deflate: true }]), 'zip', /bombe/],
    ['zip taille menteuse', zipBrut([{ nom: 'menteur.bin', data: Buffer.alloc(5 * 1024 * 1024, 7), deflate: true, usize: 10 }]), 'zip', /./],
    ['tar « .. »', tarBrut('../evade.txt', '0'), 'tar.gz', /sort ou tourne en rond/],
    ['tar lien symbolique', tarBrut('lien', '2', Buffer.alloc(0), '/etc/passwd'), 'tar.gz', /lien symbolique/],
    ['tar lien dur', tarBrut('dur', '1', Buffer.alloc(0), 'autre'), 'tar.gz', /lien dur/],
    ['tar.gz bombe', gzipSync(Buffer.alloc(300 * 1024 * 1024)), 'tar.gz', /bombe|abîmée/],
  ];
  for (const [nom, buf, genre, attendu] of pieges) {
    const t0 = performance.now();
    assert.throws(() => p.ouvrir(buf, genre, `piege ${nom}`), attendu, nom);
    assert.ok(performance.now() - t0 < 5000, `${nom} : refus rapide`);
    assert.equal(existsSync(join(home, 'sortie', `piege ${nom}`)) && readdirSync(join(home, 'sortie', `piege ${nom}`)).length > 0, false, `${nom} : rien d'écrit`);
  }
  assert.ok(!existsSync(join(home, 'evade.txt')) && !existsSync(join(home, 'sortie', 'evade.txt')));
  assert.throws(() => creerZip([{ nom: '../x', octets: Buffer.from('x') }]), /refusé/);
  assert.throws(() => nomEntreeSur('a/./b'), /refusé/);
  void zip;
});

test('archives : noms en double (casse, Unicode) et collision fichier/dossier refusés AVANT d\'écrire (relecture, constat 4)', () => {
  const { p, home } = monter();
  const pieges: Array<[string, Buffer]> = [
    ['doublon exact', zipBrut([{ nom: 'a.txt', data: Buffer.from('PREMIER') }, { nom: 'a.txt', data: Buffer.from('SECOND') }])],
    ['doublon de casse', zipBrut([{ nom: 'dossier/Rapport.txt', data: Buffer.from('x') }, { nom: 'dossier/rapport.TXT', data: Buffer.from('y') }])],
    ['doublon Unicode', zipBrut([{ nom: 'caf\u00e9.txt', data: Buffer.from('x') }, { nom: 'cafe\u0301.txt', data: Buffer.from('y') }])],
    ['fichier et dossier', zipBrut([{ nom: 'a', data: Buffer.from('x') }, { nom: 'a/b', data: Buffer.from('y') }])],
    ['dossier puis fichier', zipBrut([{ nom: 'a/b', data: Buffer.from('x') }, { nom: 'A', data: Buffer.from('y') }])],
  ];
  for (const [nom, buf] of pieges) {
    assert.throws(() => p.lireArchive(buf, 'zip'), /en double|à la fois/, nom);
    assert.throws(() => p.ouvrir(buf, 'zip', `doublon ${nom}`), /en double|à la fois/, nom);
    assert.equal(existsSync(join(home, 'sortie', `doublon ${nom}`)), false, `${nom} : rien d'écrit`);
  }
  // une archive saine s'ouvre toujours
  assert.deepEqual(p.ouvrir(zipBrut([{ nom: 'd/a.txt', data: Buffer.from('x') }, { nom: 'd/b.txt', data: Buffer.from('y') }]), 'zip', 'saine').fichiers, ['d/a.txt', 'd/b.txt']);
});

test('formules : un nom de fonction qui a la forme d\'une cellule (LOG10) n\'échappe pas à la liste blanche (relecture, constat 6)', () => {
  for (const ko of ['LOG10(A1)', 'SUM(A1)+LOG10(A2)', 'ATAN2(A1,B1)', 'A1(B2)']) assert.throws(() => formuleSure(ko), /refusée/, ko);
  for (const ok of ['SUM(A1:A3)', 'ROUND(B2,2)+A1', 'IF(A1>3,1,0)']) assert.ok(formuleSure(ok), ok);
});

test('Excel : une cellule de plus de 32 767 caractères est refusée, en le disant (relecture, constat 7)', () => {
  const { p } = monter();
  assert.throws(() => p.produire({ format: 'xlsx', titre: 'Long', feuilles: [{ nom: 'a', lignes: [['x'.repeat(40_000)]] }] }), /32 767/);
  assert.ok(p.produire({ format: 'xlsx', titre: 'Juste', feuilles: [{ nom: 'a', lignes: [['x'.repeat(32_767)]] }] }));
});

test('le filtre lit aussi le contenu : un faux bulletin titré « Document » est refusé ; un résumé ordinaire passe (seconde relecture, constat 6)', () => {
  const { p, home } = monter();
  assert.throws(() => p.produire({ format: 'pdf', titre: 'Document', texte: '# Bulletin de paie\n\nSalariée : Amara Kofi\n\nNet à payer : 2 000 €' }), /faux document|document officiel/);
  assert.throws(() => p.produire({ format: 'xlsx', titre: 'Tableau', feuilles: [{ nom: 'Payslip', lignes: [['Fake payslip'], ['Net', 2000]] }] }), /faux document|document officiel/);
  assert.throws(() => p.produire({ format: 'pptx', titre: 'Diapos', diapositives: [{ titre: 'Fausse attestation de la mairie' }] }), /faux document|document officiel/);
  assert.equal(existsSync(join(home, 'sortie')) ? readdirSync(join(home, 'sortie')).length : 0, 0, 'rien n\'est rangé');
  assert.ok(p.produire({ format: 'md', titre: 'Résumé du mois', texte: 'Résumé de mes relevés bancaires : dépenses en baisse.' }));
});
