// Alchimie · conversions faites maison (sans outil à installer) : sous-titres, données, contacts, agenda, cartes,
// archives. Fonctions pures, et vérification croisée avec de vrais outils quand ils sont là (PyYAML, tomllib,
// ffmpeg, tar, unzip, openpyxl) : ce qu'Alchimie écrit doit se relire ailleurs, et l'inverse.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { convertirMaison, ecrireCarte, ecrireIcs, ecrireSousTitres, ecrireTar, ecrireToml, ecrireVcard, ecrireXml, ecrireYaml, extMaison, lireCarte, lireIcs, lireSousTitres, lireTarMemoire, lireToml, lireVcard, lireXml, lireYaml, nomSur, peutMaison, tempsMs, versLignes, versObjets } from '../src/valhalla/dvalinn/maison.ts';
import { unzip, zip } from '../src/files/zip.ts';
import { lignesXlsx } from '../src/valhalla/modules/snotra.ts';

const py = (code: string, ...args: string[]) => execFileSync('python3', ['-c', code, ...args], { encoding: 'utf8' });
const aPy = (mod: string) => spawnSync('python3', ['-c', `import ${mod}`]).status === 0;
const a = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const conv = (nom: string, contenu: string | Buffer, vers: string) => convertirMaison(nom, Buffer.from(contenu as string), vers);

test('ce qu\'Alchimie convertit elle-même, et ce qu\'elle laisse aux outils', () => {
  for (const [nom, vers] of [['film.srt', 'vtt'], ['film.ass', 'srt'], ['paroles.lrc', 'srt'], ['clients.csv', 'json'], ['clients.csv', 'xlsx'], ['clients.xlsx', 'csv'], ['config.yml', 'toml'], ['flux.xml', 'json'], ['contacts.vcf', 'csv'], ['clients.csv', 'vcf'], ['agenda.ics', 'csv'], ['rdv.xlsx', 'ics'], ['trace.gpx', 'kml'], ['lieux.csv', 'gpx'], ['site.zip', 'tar.gz'], ['sauvegarde.tar.gz', 'zip'], ['sauvegarde.TGZ', 'zip']]) assert.ok(peutMaison(nom, vers), `${nom} → ${vers}`);
  for (const [nom, vers] of [['film.mp4', 'mp3'], ['photo.jpg', 'png'], ['doc.docx', 'pdf'], ['film.srt', 'srt'], ['film.srt', 'mp4'], ['clients.csv', 'pdf'], ['site.zip', 'rar'], ['sans-extension', 'json']]) assert.ok(!peutMaison(nom, vers), `${nom} → ${vers} n'est pas une conversion maison`);
  assert.equal(extMaison('Sauvegarde.TAR.GZ'), 'tar.gz'); assert.equal(extMaison('a.b.Srt'), 'srt'); assert.equal(extMaison('sans'), '');
  assert.throws(() => conv('film.mp4', 'x', 'mp3'), /je ne sais pas convertir/);
});

// ---------------- Sous-titres ----------------
const SRT = '1\n00:00:01,000 --> 00:00:03,500\nBonjour à tous,\nbienvenue à Mayotte !\n\n2\n00:00:04,250 --> 00:00:06,000\n<i>Voici le lagon.</i>\n\n3\n01:02:03,004 --> 01:02:05,678\nFin — merci & à bientôt\n';
test('sous-titres : SRT, WebVTT, ASS, LRC, SAMI, TTML lus ; SRT, WebVTT, ASS, LRC, texte écrits ; aller-retour sans perte', () => {
  assert.equal(tempsMs('00:01:02,345'), 62345); assert.equal(tempsMs('1:02.34'), 62340); assert.equal(tempsMs('12.5s'), 12500); assert.equal(tempsMs('01:02:03.004'), 3723004); assert.ok(Number.isNaN(tempsMs('abc')));
  const l = lireSousTitres('srt', `\ufeff${SRT.replace(/\n/g, '\r\n')}`);
  assert.deepEqual(l, [{ debut: 1000, fin: 3500, texte: 'Bonjour à tous,\nbienvenue à Mayotte !' }, { debut: 4250, fin: 6000, texte: 'Voici le lagon.' }, { debut: 3723004, fin: 3725678, texte: 'Fin — merci & à bientôt' }]);
  const vtt = ecrireSousTitres('vtt', l); assert.match(vtt, /^WEBVTT\n\n00:00:01\.000 --> 00:00:03\.500\nBonjour à tous,\nbienvenue à Mayotte !\n\n00:00:04\.250/);
  assert.deepEqual(lireSousTitres('vtt', `WEBVTT - titre\n\nNOTE un commentaire\nsur deux lignes\n\nSTYLE\n::cue { color: red }\n\nintro\n00:00:01.000 --> 00:00:03.500 align:start position:10%\n<v Fatima>Bonjour à tous,</v>\nbienvenue à Mayotte !\n\n00:04.250 --> 00:06.000\nVoici le lagon.\n`).slice(0, 2), l.slice(0, 2));
  assert.deepEqual(lireSousTitres('vtt', vtt), l, 'SRT → WebVTT → relu : identique');
  const ass = ecrireSousTitres('ass', l); assert.match(ass, /Dialogue: 0,0:00:01\.00,0:00:03\.50,Default,,0,0,0,,Bonjour à tous,\\Nbienvenue à Mayotte !/);
  assert.deepEqual(lireSousTitres('ass', ass).map((c) => c.texte), l.map((c) => c.texte)); assert.deepEqual(lireSousTitres('ssa', ass)[2].debut, 3723000, 'ASS : au centième de seconde');
  assert.deepEqual(lireSousTitres('ass', '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an8\\b1}Titre, avec une virgule\\Net deux lignes\n'), [{ debut: 1000, fin: 2000, texte: 'Titre, avec une virgule\net deux lignes' }]);
  assert.deepEqual(lireSousTitres('lrc', '[ti:Chanson]\n[00:12.50]Premier vers\n[00:17.20][01:05.00]Refrain\n[00:21.10]\n'), [{ debut: 12500, fin: 17200, texte: 'Premier vers' }, { debut: 17200, fin: 21100, texte: 'Refrain' }, { debut: 65000, fin: 69000, texte: 'Refrain' }]);
  assert.equal(ecrireSousTitres('lrc', l.slice(0, 2)), '[00:01.00]Bonjour à tous, bienvenue à Mayotte !\n[00:04.25]Voici le lagon.\n');
  assert.deepEqual(lireSousTitres('smi', '<SAMI><BODY>\n<SYNC Start=1000><P Class=FRFR>Bonjour<br>à tous\n<SYNC Start=3500><P Class=FRFR>&nbsp;\n<SYNC Start=4250><P>Voici le lagon.\n</BODY></SAMI>'), [{ debut: 1000, fin: 3500, texte: 'Bonjour\nà tous' }, { debut: 4250, fin: 8250, texte: 'Voici le lagon.' }]);
  assert.deepEqual(lireSousTitres('ttml', '<tt><body><div><p begin="00:00:01.000" end="00:00:03.500">Bonjour<br/>à tous</p><p begin="4.25s" dur="1.75s">Voici le <span>lagon</span>.</p></div></body></tt>'), [{ debut: 1000, fin: 3500, texte: 'Bonjour\nà tous' }, { debut: 4250, fin: 6000, texte: 'Voici le lagon.' }]);
  assert.equal(ecrireSousTitres('txt', l), 'Bonjour à tous,\nbienvenue à Mayotte !\nVoici le lagon.\nFin — merci & à bientôt\n');
  assert.equal(conv('film.srt', SRT, 'vtt').nom, 'film.vtt'); assert.equal(conv('Mon film.fr.vtt', vtt, 'srt').data.toString(), SRT.replace('<i>Voici le lagon.</i>', 'Voici le lagon.'));
  assert.throws(() => conv('vide.srt', 'pas de sous-titres ici', 'vtt'), /aucune réplique/);
});

test('sous-titres : ce qu\'Alchimie écrit est relu par ffmpeg, et ce que ffmpeg écrit est relu par Alchimie', { skip: !a('ffmpeg') ? 'ffmpeg absent' : false }, () => {
  const d = mkdtempSync(join(tmpdir(), 'st-')), l = lireSousTitres('srt', SRT).slice(0, 2);
  try {
    for (const fmt of ['vtt', 'ass', 'srt']) {
      writeFileSync(join(d, `a.${fmt}`), ecrireSousTitres(fmt, l));
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(d, `a.${fmt}`), join(d, `relu-${fmt}.srt`)]);
      assert.deepEqual(lireSousTitres('srt', readFileSync(join(d, `relu-${fmt}.srt`), 'utf8')).map((c) => [c.debut, c.fin, c.texte]), l.map((c) => [c.debut, c.fin, c.texte]), `ffmpeg relit le ${fmt} d'Alchimie`);
    }
    writeFileSync(join(d, 'src.srt'), SRT); execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(d, 'src.srt'), join(d, 'ff.ass')]); execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(d, 'src.srt'), join(d, 'ff.vtt')]);
    assert.deepEqual(lireSousTitres('ass', readFileSync(join(d, 'ff.ass'), 'utf8')).map((c) => c.texte), ['Bonjour à tous,\nbienvenue à Mayotte !', 'Voici le lagon.', 'Fin — merci & à bientôt'], 'Alchimie relit l\'ASS de ffmpeg (balises retirées)');
    assert.deepEqual(lireSousTitres('vtt', readFileSync(join(d, 'ff.vtt'), 'utf8')).map((c) => c.debut), [1000, 4250, 3723004]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ---------------- Données ----------------
const YAML = `# Une pile de services
version: "3.9"
services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
      - 8443:443
    environment:
      - TZ=Indian/Mayotte
      - MOT='avec # pas un commentaire'
    restart: unless-stopped   # commentaire en fin de ligne
    healthcheck: { test: [CMD, curl, "-f", "http://localhost"], interval: 30s, retries: 3 }
  base:
    image: postgres:16
    volumes: [donnees:/var/lib/postgresql/data, ./init:/docker-entrypoint-initdb.d]
    actif: true
    replicas: 2
    note: null
titre: 'L''atelier de Fatima'
description: |
  Première ligne.
  Deuxième ligne : avec deux-points.

  Après une ligne vide.
resume: >-
  Une phrase
  sur deux lignes.
vide: []
personnes:
  - nom: Fatima
    age: 31
    langues: [fr, shimaoré]
  - nom: Saïd
    age: 28
`;
test('YAML : lu comme PyYAML le lit, et ce qu\'Alchimie écrit se relit pareil', { skip: !aPy('yaml') ? 'PyYAML absent' : false }, () => {
  const d = mkdtempSync(join(tmpdir(), 'yaml-'));
  try {
    writeFileSync(join(d, 'a.yaml'), YAML);
    const vrai = JSON.parse(py('import yaml, json, sys\nprint(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf8"))))', join(d, 'a.yaml'))) as unknown, lu = lireYaml(YAML);
    assert.deepEqual(lu, vrai);
    writeFileSync(join(d, 'b.yaml'), ecrireYaml(lu));
    assert.deepEqual(JSON.parse(py('import yaml, json, sys\nprint(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf8"))))', join(d, 'b.yaml'))), vrai, 'PyYAML relit le YAML d\'Alchimie');
    assert.deepEqual(lireYaml(ecrireYaml(lu)), vrai);
    // Valeurs piégeuses : elles doivent rester du texte après un aller-retour.
    const pieges = { a: 'true', b: '12', c: 'null', d: 'texte: avec deux-points', e: '# pas un commentaire', f: '', g: ' espaces ', h: 'ligne 1\nligne 2\n', i: '- tiret', j: 'été à Mamoudzou', k: ['x', ['y', 'z'], { m: 1 }], 'clé avec espace': 1, l: 1.5, n: -3, o: false };
    writeFileSync(join(d, 'c.yaml'), ecrireYaml(pieges));
    assert.deepEqual(JSON.parse(py('import yaml, json, sys\nprint(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf8"))))', join(d, 'c.yaml'))), pieges); assert.deepEqual(lireYaml(ecrireYaml(pieges)), pieges);
  } finally { rmSync(d, { recursive: true, force: true }); }
  assert.deepEqual(lireYaml('- a\n- b: 1\n  c: 2\n- [x, y]\n'), ['a', { b: 1, c: 2 }, ['x', 'y']]); assert.deepEqual(lireYaml('42\n'), 42); assert.deepEqual(lireYaml(''), null);
  assert.throws(() => lireYaml('cle: 1\nligne sans deux-points\n'), /YAML : ligne 2 illisible/);
});

const TOML = `# Réglages
titre = "Site de Fatima"
port = 8_080
actif = true
ratio = 0.75
chemin = 'C:\\Users\\Fatima'
langues = ["fr", "en",
  "shimaoré"]   # sur deux lignes
point = { x = 1, y = 2 }
texte = """
Première ligne
Deuxième ligne"""

[serveur]
hote = "192.168.1.20"
"clé avec espace" = 1

[serveur.tls]
actif = false
ports = [443, 8443]

[[produits]]
nom = "Brochettes"
prix = 5.5

[[produits]]
nom = "Samoussas"
prix = 3
etiquettes = ["chaud", "épicé"]
`;
test('TOML : lu comme Python le lit, et ce qu\'Alchimie écrit se relit pareil', { skip: !aPy('tomllib') ? 'tomllib absent' : false }, () => {
  const d = mkdtempSync(join(tmpdir(), 'toml-'));
  try {
    writeFileSync(join(d, 'a.toml'), TOML);
    const lirePy = (f: string) => JSON.parse(py('import tomllib, json, sys\nprint(json.dumps(tomllib.load(open(sys.argv[1], "rb"))))', f)) as unknown, vrai = lirePy(join(d, 'a.toml')), lu = lireToml(TOML);
    assert.deepEqual(lu, vrai);
    writeFileSync(join(d, 'b.toml'), ecrireToml(lu)); assert.deepEqual(lirePy(join(d, 'b.toml')), vrai, 'Python relit le TOML d\'Alchimie'); assert.deepEqual(lireToml(ecrireToml(lu)), vrai);
  } finally { rmSync(d, { recursive: true, force: true }); }
  assert.throws(() => lireToml('ligne sans égal\n'), /TOML : ligne 1 illisible/);
});

test('XML et tableaux : lecture, écriture, aller-retour ; un dictionnaire imbriqué devient des colonnes « a.b »', () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- commentaire -->\n<catalogue devise="EUR">\n  <produit id="1"><nom>Brochettes &amp; frites</nom><prix>5.5</prix><stock>12</stock></produit>\n  <produit id="2"><nom><![CDATA[Samoussas <épicés>]]></nom><prix>3</prix><epuise/></produit>\n  <note>à &#233;couler</note>\n</catalogue>';
  const v = lireXml(xml);
  assert.deepEqual(v, { catalogue: { '@devise': 'EUR', produit: [{ '@id': '1', nom: 'Brochettes & frites', prix: 5.5, stock: 12 }, { '@id': '2', nom: 'Samoussas <épicés>', prix: 3, epuise: null }], note: 'à écouler' } });
  assert.deepEqual(lireXml(ecrireXml(v)), v, 'XML → relu : identique');
  assert.match(ecrireXml(v), /<produit id="1">\n {4}<nom>Brochettes &amp; frites<\/nom>/);
  assert.throws(() => lireXml('<a><b></a>'), /XML/); assert.throws(() => lireXml('pas du xml'), /aucun élément/);
  const lignes = versLignes([{ nom: 'Fatima', adresse: { ville: 'Mamoudzou', cp: 97600 }, langues: ['fr', 'shimaoré'] }, { nom: 'Saïd', tel: '0639' }]);
  assert.deepEqual(lignes, [['nom', 'adresse.ville', 'adresse.cp', 'langues', 'tel'], ['Fatima', 'Mamoudzou', '97600', 'fr | shimaoré', ''], ['Saïd', '', '', '', '0639']]);
  assert.deepEqual(versObjets([['Nom', 'Âge', ''], ['Fatima', '31', 'x'], ['Saïd', '028', '']]), [{ Nom: 'Fatima', 'Âge': 31, colonne_3: 'x' }, { Nom: 'Saïd', 'Âge': '028', colonne_3: '' }], 'un nombre qui commence par 0 (code postal, téléphone) reste un texte');
  assert.deepEqual(versLignes({ clients: [{ a: 1 }, { a: 2 }] }), [['a'], ['1'], ['2']], 'un dictionnaire qui ne contient qu\'une liste : c\'est la liste qui devient le tableau');
});

test('données : CSV, JSON, JSON Lines, YAML, TOML, XML, Excel se convertissent entre eux', { skip: !aPy('openpyxl') ? 'openpyxl absent' : false }, () => {
  const csv = 'Produit;Prix;Stock;Code\nBrochettes;5,5;12;0976\n"Samoussas; épicés";3;0;0042\n';
  const json = conv('carte.csv', csv, 'json'); assert.equal(json.nom, 'carte.json');
  assert.deepEqual(JSON.parse(json.data.toString()), [{ Produit: 'Brochettes', Prix: '5,5', Stock: 12, Code: '0976' }, { Produit: 'Samoussas; épicés', Prix: 3, Stock: 0, Code: '0042' }]);
  const yaml = conv('carte.json', json.data, 'yaml').data.toString(); assert.match(yaml, /^- Produit: Brochettes\n {2}Prix: "5,5"\n {2}Stock: 12\n {2}Code: "0976"\n- Produit: "Samoussas; épicés"/);
  const retour = conv('carte.yaml', yaml, 'csv').data.toString(); assert.equal(retour.replace(/^\ufeff/, ''), csv, 'CSV → JSON → YAML → CSV : identique');
  assert.equal(conv('carte.json', json.data, 'jsonl').data.toString().split('\n').filter(Boolean).length, 2); assert.deepEqual(JSON.parse(conv('carte.jsonl', '{"a":1}\n\n{"a":2}\n', 'json').data.toString()), [{ a: 1 }, { a: 2 }]);
  assert.match(conv('carte.csv', csv, 'tsv').data.toString(), /^Produit\tPrix\tStock\tCode\nBrochettes\t5,5\t12\t0976\n/);
  assert.match(conv('carte.csv', csv, 'xml').data.toString(), /<donnees>\n {2}<element>\n {4}<Produit>Brochettes<\/Produit>/);
  assert.match(conv('carte.csv', csv, 'toml').data.toString(), /\[\[element\]\]\nProduit = "Brochettes"\nPrix = "5,5"\nStock = 12/);
  // Excel : écrit par Alchimie, relu par openpyxl ; puis Excel → CSV.
  const d = mkdtempSync(join(tmpdir(), 'donnees-'));
  try {
    const x = conv('carte.csv', csv, 'xlsx'); writeFileSync(join(d, x.nom), x.data);
    assert.deepEqual(JSON.parse(py('import openpyxl, json, sys\ns = openpyxl.load_workbook(sys.argv[1]).active\nprint(json.dumps([[c.value for c in r] for r in s.iter_rows()]))', join(d, 'carte.xlsx'))), [['Produit', 'Prix', 'Stock', 'Code'], ['Brochettes', 5.5, 12, '0976'], ['Samoussas; épicés', 3, 0, '0042']], 'les codes qui commencent par 0 restent du texte dans Excel');
    assert.deepEqual(lignesXlsx(x.data)[1], ['Brochettes', '5.5', '12', '0976']);
    assert.match(conv('carte.xlsx', x.data, 'csv').data.toString(), /Brochettes;5\.5;12;0976/);
  } finally { rmSync(d, { recursive: true, force: true }); }
  assert.throws(() => conv('casse.json', '{ pas du json', 'csv'), /JSON|Unexpected|Expected/i); assert.throws(() => conv('casse.jsonl', '{"a":1}\n{oups\n', 'json'), /ligne 2/);
});

// ---------------- Contacts et agenda ----------------
test('contacts : vCard ↔ CSV ; agenda : iCalendar ↔ CSV', () => {
  const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Ali;Fatima;;;\r\nFN:Fatima Ali\r\nORG:TOUFATECH;Atelier\r\nTITLE:Gérante\r\nTEL;TYPE=CELL:+262 639 12 34 56\r\nTEL;TYPE=WORK:0269 61 00 00\r\nEMAIL;TYPE=INTERNET:fatima@exemple.fr\r\nADR;TYPE=WORK:;;12 rue du Commerce;Mamoudzou;;97600;Mayotte\r\nNOTE:Cliente depuis 2022\\, paie\r\n  comptant\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:4.0\r\nFN:Saïd M.\r\nitem1.EMAIL:said@exemple.fr\r\nEND:VCARD\r\n';
  const l = lireVcard(vcf);
  assert.deepEqual(l[0], { nom_de_famille: 'Ali', prenom: 'Fatima', nom: 'Fatima Ali', societe: 'TOUFATECH · Atelier', fonction: 'Gérante', telephone: '+262 639 12 34 56 | 0269 61 00 00', email: 'fatima@exemple.fr', adresse: '12 rue du Commerce, Mamoudzou, 97600, Mayotte', note: 'Cliente depuis 2022, paie comptant' });
  assert.deepEqual(l[1], { nom: 'Saïd M.', email: 'said@exemple.fr' });
  const csv = conv('contacts.vcf', vcf, 'csv').data.toString(); assert.match(csv, /^\ufeffnom;nom_de_famille;prenom;societe;fonction;telephone;email;adresse;note\nFatima Ali;Ali;Fatima;TOUFATECH · Atelier;Gérante;/);
  const retour = conv('contacts.csv', 'Nom;Téléphone;Email;Société\nFatima Ali;+262 639 12 34 56 | 0269 61 00 00;fatima@exemple.fr;TOUFATECH\n;0600;x@y.fr;Sans nom\n', 'vcf').data.toString();
  assert.match(retour, /BEGIN:VCARD\r\nVERSION:3\.0\r\nFN:Fatima Ali\r\nN:Fatima Ali;;;;\r\nTEL;TYPE=CELL:\+262 639 12 34 56\r\nTEL;TYPE=CELL:0269 61 00 00\r\nEMAIL:fatima@exemple\.fr\r\nORG:TOUFATECH\r\nEND:VCARD\r\n$/, 'la ligne sans nom est laissée');
  assert.deepEqual(lireVcard(ecrireVcard([{ nom: 'A; B, C', note: 'ligne 1\nligne 2' }]))[0].note, 'ligne 1\nligne 2');
  assert.throws(() => conv('x.csv', 'Ville;Pays\nMamoudzou;Mayotte\n', 'vcf'), /colonne « nom »/); assert.throws(() => conv('vide.vcf', 'rien', 'csv'), /aucun contact/);
  const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART;TZID=Indian/Mayotte:20261120T140000\r\nDTEND;TZID=Indian/Mayotte:20261120T150000\r\nSUMMARY:Rendez-vous client\\, devis\r\nLOCATION:Mamoudzou\r\nDESCRIPTION:Apporter le\r\n  contrat\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261224\r\nSUMMARY:Fermeture\r\nRRULE:FREQ=YEARLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  assert.deepEqual(lireIcs(ics), [{ debut: '2026-11-20 14:00', fin: '2026-11-20 15:00', titre: 'Rendez-vous client, devis', lieu: 'Mamoudzou', description: 'Apporter le contrat' }, { debut: '2026-12-24', titre: 'Fermeture', repetition: 'FREQ=YEARLY' }]);
  const ecrit = ecrireIcs([{ Titre: 'Livraison', 'Début': '2026-11-20 14:00', Fin: '2026-11-20 15:30', Lieu: 'Kawéni' }, { titre: 'Fermeture', date: '24/12/2026' }, { titre: 'sans date' }], new Date('2026-11-13T15:00:00Z'));
  assert.match(ecrit, /BEGIN:VEVENT\r\nUID:odin-20261113T150000Z-0@alchimie\r\nDTSTAMP:20261113T150000Z\r\nDTSTART:20261120T140000\r\nDTEND:20261120T153000\r\nSUMMARY:Livraison\r\nLOCATION:Kawéni\r\nEND:VEVENT/); assert.match(ecrit, /DTSTART;VALUE=DATE:20261224\r\nSUMMARY:Fermeture/); assert.equal((ecrit.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.deepEqual(lireIcs(ecrit).map((e) => [e.titre, e.debut]), [['Livraison', '2026-11-20 14:00'], ['Fermeture', '2026-12-24']]);
  assert.match(conv('agenda.ics', ics, 'csv').data.toString(), /debut;fin;titre;lieu;description;repetition\n2026-11-20 14:00;2026-11-20 15:00;"?Rendez-vous client, devis"?;Mamoudzou/);
});

// ---------------- Cartes ----------------
test('cartes : GeoJSON, KML, GPX se convertissent entre eux ; un tableau de lieux devient une carte', () => {
  const geo = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: 'Mamoudzou', description: 'Chef-lieu' }, geometry: { type: 'Point', coordinates: [45.2279, -12.7806] } },
    { type: 'Feature', properties: { name: 'Barge' }, geometry: { type: 'LineString', coordinates: [[45.2279, -12.7806], [45.2800, -12.7900, 2]] } },
    { type: 'Feature', properties: { nom: 'Îlot' }, geometry: { type: 'Polygon', coordinates: [[[45.1, -12.9], [45.2, -12.9], [45.2, -12.8], [45.1, -12.9]]] } },
  ] });
  const l = lireCarte('geojson', geo);
  assert.deepEqual(l.map((x) => [x.nom, x.type, x.points.length]), [['Mamoudzou', 'point', 1], ['Barge', 'ligne', 2], ['Îlot', 'surface', 4]]);
  const kml = ecrireCarte('kml', l); assert.match(kml, /<Placemark><name>Mamoudzou<\/name><description>Chef-lieu<\/description><Point><coordinates>45\.2279,-12\.7806<\/coordinates><\/Point><\/Placemark>/); assert.match(kml, /<LinearRing><coordinates>45\.1,-12\.9 45\.2,-12\.9/);
  assert.deepEqual(lireCarte('kml', kml), l, 'GeoJSON → KML → relu : identique');
  const gpx = ecrireCarte('gpx', l); assert.match(gpx, /<wpt lat="-12\.7806" lon="45\.2279"><name>Mamoudzou<\/name><desc>Chef-lieu<\/desc><\/wpt>/); assert.match(gpx, /<trk><name>Barge<\/name><trkseg><trkpt lat="-12\.7806" lon="45\.2279"><\/trkpt><trkpt lat="-12\.79" lon="45\.28"><ele>2<\/ele><\/trkpt>/);
  const relu = lireCarte('gpx', gpx); assert.deepEqual(relu.slice(0, 2), l.slice(0, 2)); assert.equal(relu[2].type, 'ligne', 'le GPX n\'a pas de surface : elle devient un tracé');
  assert.deepEqual(lireCarte('gpx', '<gpx><wpt lat="-12.78" lon="45.22"/><rte><name>Route</name><rtept lat="1" lon="2"/><rtept lat="3" lon="4"/></rte></gpx>').map((x) => [x.nom, x.type, x.points]), [[undefined, 'point', [[45.22, -12.78]]], ['Route', 'ligne', [[2, 1], [4, 3]]]]);
  assert.deepEqual(JSON.parse(conv('lieux.kml', kml, 'geojson').data.toString()).features.map((f: { geometry: { type: string } }) => f.geometry.type), ['Point', 'LineString', 'Polygon']);
  assert.match(conv('trace.gpx', gpx, 'csv').data.toString(), /nom;type;latitude;longitude;altitude;description\nMamoudzou;point;-12\.7806;45\.2279;;Chef-lieu\nBarge;ligne;-12\.7806;45\.2279;;\nBarge;ligne;-12\.79;45\.28;2;/);
  const depuis = conv('clients.csv', 'Nom;Latitude;Longitude;Note\nBoutique;-12,7806;45,2279;ouverte\nSans lieu;;;\n', 'gpx').data.toString(); assert.match(depuis, /<wpt lat="-12\.7806" lon="45\.2279"><name>Boutique<\/name><desc>ouverte<\/desc><\/wpt>/); assert.equal((depuis.match(/<wpt/g) ?? []).length, 1);
  assert.throws(() => conv('x.csv', 'Nom;Ville\nA;B\n', 'kml'), /latitude/); assert.deepEqual(lireCarte('geojson', '{"type":"Point","coordinates":[500,95]}'), [], 'des coordonnées impossibles sont écartées');
});

// ---------------- Archives ----------------
test('archives : ZIP, TAR, TAR.GZ entre elles ; relues par tar et unzip ; jamais de chemin qui sort du dossier', { skip: !a('tar') || !a('unzip') ? 'tar ou unzip absent' : false }, () => {
  const d = mkdtempSync(join(tmpdir(), 'arch-')), long = `${'dossier-vraiment-long/'.repeat(6)}fichier.txt`;
  try {
    const l = [{ nom: 'site/index.html', data: Buffer.from('<h1>Bonjour</h1>') }, { nom: 'site/été/photo.bin', data: Buffer.alloc(3000, 7) }, { nom: long, data: Buffer.from('long') }, { nom: 'vide.txt', data: Buffer.alloc(0) }];
    const tar = ecrireTar(l); assert.deepEqual(lireTarMemoire(tar).map((x) => [x.nom, x.data.length]), l.map((x) => [x.nom, x.data.length]));
    writeFileSync(join(d, 'a.tar'), tar);
    assert.deepEqual(execFileSync('tar', ['--quoting-style=literal', '-tf', join(d, 'a.tar')], { encoding: 'utf8' }).trim().split('\n'), l.map((x) => x.nom), 'tar relit l\'archive d\'Alchimie (noms longs et accents compris)');
    mkdirSync(join(d, 'x')); execFileSync('tar', ['-xf', join(d, 'a.tar'), '-C', join(d, 'x')]); assert.equal(readFileSync(join(d, 'x', 'site/index.html'), 'utf8'), '<h1>Bonjour</h1>');
    // L'archive de tar (GNU), relue par Alchimie, puis convertie en ZIP relu par unzip.
    execFileSync('tar', ['-czf', join(d, 'b.tar.gz'), '-C', join(d, 'x'), '.']);
    const z = convertirMaison('b.tar.gz', readFileSync(join(d, 'b.tar.gz')), 'zip'); assert.equal(z.nom, 'b.zip'); writeFileSync(join(d, z.nom), z.data);
    assert.deepEqual(execFileSync('unzip', ['-Z1', join(d, 'b.zip')], { encoding: 'utf8' }).trim().split('\n').sort(), l.map((x) => x.nom).sort());
    assert.equal(unzip(z.data).get('site/index.html')?.toString(), '<h1>Bonjour</h1>');
    const t2 = convertirMaison('b.zip', z.data, 'tar.gz'); writeFileSync(join(d, 'c.tar.gz'), t2.data); assert.equal(execFileSync('tar', ['-xzOf', join(d, 'c.tar.gz'), long], { encoding: 'utf8' }), 'long');
    assert.equal(convertirMaison('a.tar', tar, 'zip').nom, 'a.zip');
    // Une archive piégée (« ../../etc/passwd », chemin absolu) : les noms sont ramenés dans le dossier.
    const piege = zip([{ name: '../../etc/passwd', data: Buffer.from('x') }, { name: '/racine.txt', data: Buffer.from('y') }, { name: 'a/./b/../c.txt', data: Buffer.from('z') }]);
    assert.deepEqual(lireTarMemoire(convertirMaison('piege.zip', piege, 'tar').data).map((x) => x.nom), ['etc/passwd', 'racine.txt', 'a/b/c.txt']);
    assert.equal(nomSur('..\\..\\Windows\\System32\\x.dll'), 'Windows/System32/x.dll');
    assert.throws(() => convertirMaison('casse.zip', Buffer.from('pas un zip'), 'tar'));
  } finally { rmSync(d, { recursive: true, force: true }); }
});
