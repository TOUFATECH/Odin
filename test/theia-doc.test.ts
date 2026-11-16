// Théia — lecture de documents sans dépendance (Lot B). On vérifie, sans aucun outil de bureautique :
//   - un .odt (archive zip + XML, comme la norme OpenDocument) rend son texte et sa structure ;
//   - un .ods et un .odp minimaux rendent leurs cellules / leur texte ;
//   - un RTF et un HTML rendent leur texte ;
//   - un PDF scanné minuscule rend une image de page non vide (DCTDecode = JPEG) ;
//   - un format non couvert (vieux binaire) est marqué « lu en partie », pas une erreur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zip } from '../src/files/zip.ts';
import { imagesPagesPdf, lireDocument, lireHtml, lireOdf, lireRtf } from '../src/valhalla/theia/documents.ts';

/** Un OpenDocument minimal : le mimetype (stocké), content.xml avec le corps donné. */
function odf(mimetype: string, corps: string): Buffer {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
<office:body>${corps}</office:body></office:document-content>`;
  return zip([
    { name: 'mimetype', data: Buffer.from(mimetype), store: true },
    { name: 'content.xml', data: Buffer.from(content) },
  ]);
}

test('Théia lit un .odt (texte, titre, liste, tableau)', () => {
  const buf = odf('application/vnd.oasis.opendocument.text', `<office:text>
<text:h text:outline-level="1">Rapport du salon</text:h>
<text:p>Bonjour, voici le <text:span>résumé</text:span> de la journée.</text:p>
<text:list><text:list-item><text:p>un chien</text:p></text:list-item><text:list-item><text:p>un canapé</text:p></text:list-item></text:list>
<table:table><table:table-row><table:table-cell><text:p>Pièce</text:p></table:table-cell><table:table-cell><text:p>Objet</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>salon</text:p></table:table-cell><table:table-cell><text:p>lampe</text:p></table:table-cell></table:table-row></table:table>
</office:text>`);
  const d = lireOdf(buf, 'odt');
  assert.equal(d.lu, true);
  assert.equal(d.partiel, false);
  assert.match(d.texte, /Rapport du salon/);
  assert.match(d.texte, /résumé de la journée/);
  assert.match(d.texte, /un chien/);
  assert.match(d.texte, /salon\tlampe/);
  assert.equal(d.blocs[0].type, 'titre');
  assert.equal(d.blocs.find((b) => b.type === 'tableau')?.lignes?.length, 2);
});

test('Théia lit un .ods (cellules) et un .odp (texte de diapositive)', () => {
  const ods = odf('application/vnd.oasis.opendocument.spreadsheet',
    `<office:spreadsheet><table:table><table:table-row><table:table-cell><text:p>Janvier</text:p></table:table-cell><table:table-cell><text:p>120</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>`);
  assert.match(lireOdf(ods, 'ods').texte, /Janvier\t120/);
  const odp = odf('application/vnd.oasis.opendocument.presentation',
    `<office:presentation><draw:page><text:p>Ma présentation</text:p></draw:page></office:presentation>`);
  assert.match(lireOdf(odp, 'odp').texte, /Ma présentation/);
});

test('Théia lit un RTF', () => {
  const rtf = Buffer.from('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Bonjour \\u233? \\par Deuxi\\u232?me ligne\\par}', 'latin1');
  const d = lireRtf(rtf);
  assert.equal(d.lu, true);
  assert.match(d.texte, /Bonjour é/);
  assert.match(d.texte, /Deuxième ligne/);
});

test('Théia lit un HTML (titre, liste, tableau, paragraphe ; scripts retirés)', () => {
  const html = `<html><head><title>Page</title><style>.x{}</style></head><body>
<h2>Titre</h2><p>Un paragraphe <b>gras</b>.</p>
<ul><li>pomme</li><li>poire</li></ul>
<table><tr><td>a</td><td>b</td></tr></table>
<script>alert('x')</script></body></html>`;
  const d = lireHtml(html);
  assert.equal(d.lu, true);
  assert.match(d.texte, /# .*|## Titre/);
  assert.match(d.texte, /Un paragraphe gras ?\./);
  assert.match(d.texte, /- pomme/);
  assert.match(d.texte, /a\tb/);
  assert.doesNotMatch(d.texte, /alert/);
});

test('Théia extrait l\'image d\'une page d\'un PDF scanné (DCTDecode)', () => {
  // Un JPEG minuscule (en-tête JFIF + fin) : le contenu importe peu, l'extracteur rend les octets du flux tels quels.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
  const dict = `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode /Length ${jpeg.length} >>`;
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n5 0 obj\n' + dict + '\nstream\n', 'latin1'),
    jpeg,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
  const imgs = imagesPagesPdf(pdf);
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].genre, 'jpeg');
  assert.ok(imgs[0].data.length > 0, 'image de page non vide');
  assert.equal(imgs[0].largeur, 2);
});

test('Théia marque un vieux format binaire « lu en partie », sans erreur', () => {
  const d = lireDocument(Buffer.from('un vieux .doc binaire'), 'rapport.doc');
  assert.equal(d.lu, false);
  assert.equal(d.partiel, true);
  assert.match(d.via, /vieux format/);
});
