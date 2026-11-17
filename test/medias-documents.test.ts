// Médias reçus : les métadonnées des documents (PDF, Word, OpenDocument, EPUB), lues sur la machine, bornées.
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { lireMetadonnees } from '../src/medias/metadonnees.ts';
import * as F from './medias-fabriquer.ts';

const champ = (f: ReturnType<typeof lireMetadonnees>, cle: string) => f.champs.find((c) => c.cle === cle);

test('PDF /Info : titre, auteur, date de création avec fuseau ; /Lang en-US', () => {
  const f = lireMetadonnees({ octets: F.pdfMinimal({ info: { Title: 'Facture 2026-117', Author: 'Awa Saïd', CreationDate: 'D:20261103101500+01\'00\'' }, lang: 'en-US' }), nom: 'facture.pdf' });
  assert.equal(f.illisible, undefined);
  assert.equal(champ(f, 'titre')?.valeur, 'Facture 2026-117');
  assert.equal(champ(f, 'auteur_document')?.valeur, 'Awa Saïd');
  const d = f.dates.find((x) => x.role === 'création du fichier');
  assert.equal(d?.iso, '2026-11-03T10:15:00+01:00');
  assert.equal(d?.utc, '2026-11-03T09:15:00Z');
  assert.equal(champ(f, 'langue_declaree')?.valeur, 'en-US');
  assert.deepEqual(f.languesDeclarees.map((l) => l.code), ['en-US']);
});

test('PDF avec table xref, UTF-16BE et nombre de pages', () => {
  const titre = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('Лагон 🌊', 'utf16le').swap16()]);
  const objets = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [] /Count 3 >> endobj\n',
    `3 0 obj << /Title <${titre.toString('hex')}> /Producer (Odin \\(essai\\)) >> endobj\n`,
  ];
  let corps = '%PDF-1.4\n';
  const decalages: number[] = [];
  for (const o of objets) { decalages.push(Buffer.byteLength(corps, 'latin1')); corps += o; }
  const xref = Buffer.byteLength(corps, 'latin1');
  corps += `xref\n0 4\n0000000000 65535 f \n${decalages.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}trailer << /Size 4 /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const f = lireMetadonnees({ octets: F.lat(corps) });
  assert.equal(champ(f, 'titre')?.valeur, 'Лагон 🌊');
  assert.equal(champ(f, 'pages')?.valeur, '3');
  assert.equal(champ(f, 'x:producteur_pdf')?.valeur, 'Odin (essai)');
});

test('PDF à références circulaires : partiel, sans boucle', () => {
  const pdf = F.lat('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj 3 0 R endobj\n3 0 obj 2 0 R endobj\n4 0 obj << /Title (Boucle) >> endobj\ntrailer << /Root 1 0 R /Info 4 0 R >>\n%%EOF\n');
  const t0 = performance.now();
  const f = lireMetadonnees({ octets: pdf });
  assert.ok(performance.now() - t0 < 100);
  assert.equal(champ(f, 'titre')?.valeur, 'Boucle');
  assert.ok(f.partiel?.includes('boucle évitée'), f.partiel);
});

test('PDF : flux xref bombe → refus « décompression suspecte », en moins de 100 ms', () => {
  const bombe = deflateSync(Buffer.alloc(40 * 1024 * 1024));
  const tete = '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n';
  const dec = Buffer.byteLength(tete, 'latin1');
  const obj = Buffer.concat([F.lat(`2 0 obj << /Type /XRef /Size 3 /W [1 4 2] /Root 1 0 R /Filter /FlateDecode /Length ${bombe.length} >> stream\n`), bombe, F.lat('\nendstream endobj\n')]);
  const pdf = Buffer.concat([F.lat(tete), obj, F.lat(`startxref\n${dec}\n%%EOF\n`)]);
  const t0 = performance.now();
  const f = lireMetadonnees({ octets: pdf });
  const ms = performance.now() - t0;
  assert.ok(ms < 100, `${Math.round(ms)} ms`);
  const dit = `${f.partiel ?? ''} ${f.illisible ?? ''} ${f.remarques.join(' ')}`;
  assert.ok(dit.includes('décompression suspecte'), dit);
});

test('docx : core.xml (auteur, modifié par sensible, langue) et app.xml', () => {
  const doc = F.zipAvec([
    ['[Content_Types].xml', F.utf8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')],
    ['docProps/core.xml', F.utf8('<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Contrat</dc:title><dc:creator>Awa Saïd</dc:creator><cp:lastModifiedBy>Saïd Ali</cp:lastModifiedBy><dc:language>fr-FR</dc:language><dcterms:created>2026-08-14T09:00:00Z</dcterms:created></cp:coreProperties>')],
    ['docProps/app.xml', F.utf8('<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Traitement de texte</Application><Pages>2</Pages><Words>350</Words><Company>Ylang</Company></Properties>')],
    ['word/document.xml', F.utf8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')],
  ]);
  const f = lireMetadonnees({ octets: doc, nom: 'contrat.docx' });
  assert.equal(f.nature.format, 'docx');
  assert.equal(champ(f, 'auteur_document')?.valeur, 'Awa Saïd');
  assert.equal(champ(f, 'modifie_par')?.sensible, true);
  assert.equal(champ(f, 'langue_declaree')?.valeur, 'fr-FR');
  assert.equal(champ(f, 'pages')?.valeur, '2');
  assert.equal(champ(f, 'entreprise')?.valeur, 'Ylang');
  assert.equal(f.dates.find((d) => d.role === 'création du fichier')?.utc, '2026-08-14T09:00:00Z');
});

test('odt : meta.xml ; epub : OPF', () => {
  const odt = F.zipAvec([['mimetype', F.lat('application/vnd.oasis.opendocument.text')], ['meta.xml', F.utf8('<?xml version="1.0"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><office:meta><dc:title>Rapport</dc:title><meta:initial-creator>Awa Saïd</meta:initial-creator><dc:language>sw</dc:language><meta:document-statistic meta:page-count="4" meta:word-count="1200"/><meta:keyword>lagon</meta:keyword><meta:keyword>récif</meta:keyword></office:meta></office:document-meta>')]]);
  const f = lireMetadonnees({ octets: odt });
  assert.equal(champ(f, 'titre')?.valeur, 'Rapport');
  assert.equal(champ(f, 'pages')?.valeur, '4');
  assert.deepEqual(champ(f, 'mots_cles')?.valeurs, ['lagon', 'récif']);
  assert.equal(champ(f, 'langue_declaree')?.valeur, 'sw');
  const epub = F.zipAvec([['mimetype', F.lat('application/epub+zip')], ['META-INF/container.xml', F.utf8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/livre.opf"/></rootfiles></container>')], ['OEBPS/livre.opf', F.utf8('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Contes de Mayotte</dc:title><dc:creator>Awa Saïd</dc:creator><dc:language>fr</dc:language><dc:publisher>Éditions Ylang</dc:publisher><dc:date>2025-06-01</dc:date></metadata></package>')]]);
  const e = lireMetadonnees({ octets: epub });
  assert.equal(e.nature.format, 'epub');
  assert.equal(champ(e, 'titre')?.valeur, 'Contes de Mayotte');
  assert.equal(champ(e, 'x:editeur')?.valeur, 'Éditions Ylang');
  assert.equal(e.dates.find((d) => d.role === 'parution')?.iso, '2025-06-01');
});

test('ancien fichier Office (OLE) : le manque est dit', () => {
  const f = lireMetadonnees({ octets: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]) });
  assert.ok(f.manque.some((m) => m.code === 'format-non-lu' && m.raison.includes('anciens fichiers Office')));
});
