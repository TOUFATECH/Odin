// Garde-fou des formes (filet 2 du lot 0 du plan de la maquette de l'accueil), sans clé : il tourne partout. Il lit les
// fichiers de ce chantier, reconnus par leur nom : les fichiers neufs du produit (src/web/pages/themes-*.js,
// accueil-*.js, widgets-*.js, maison-*.js, menu-ecrans.js, src/valhalla/widgets/**, src/web/widgets-api.ts) et les
// essais neufs du plan (test/themes-*, accueil-*, widgets-*, maison-*, menus-*, menu-ordre*, barre-bas*,
// fenetre-grille*, talos-editeur-cercles*, talos-editeur-bulles*, talos-editeur-liaisons*). Trois fichiers d'avant le
// chantier portent un de ces noms et sont exclus par leur nom. Le dépôt est public : une donnée d'exemple a souvent la
// forme d'une adresse.
//  - Dans un fichier du produit, refusé : une adresse IP écrite en dur ; un nom de domaine autre que example.org ;
//    une adresse http vers l'extérieur ; un fuseau horaire écrit en dur ; fr-FR écrit en dur.
//  - Dans un essai, refusé : une adresse IP hors des plages réservées aux exemples (198.51.100.x, 192.0.2.x,
//    203.0.113.x ; ni la boucle locale ni l'adresse nulle : un essai lit l'adresse de son Odin d'essai, il ne
//    l'écrit pas) ; un nom de domaine autre que example.org.
// Dans le code (JS, TS, JSON), les noms de domaine sont cherchés dans les chaînes et les commentaires seulement (pas
// dans « objet.fr » du code) ; dans les autres fichiers (HTML, Markdown…), dans tout le texte. Seulement avec un
// suffixe connu (.com, .fr, .org…). Les espaces de noms XML (http://www.w3.org/2000/svg…) ne sont pas
// des adresses : ils sont admis. Une faute est dite par fichier, ligne et genre, sans recopier la valeur.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

type Faute = { fichier: string; ligne: number; genre: string };

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

// Même liste que donnees-exemple.test.ts.
const CHANTIER = [
  /^src\/web\/pages\/(themes|accueil|widgets|maison)-[^/]*\.js$/,
  /^src\/web\/pages\/menu-ecrans\.js$/,
  /^src\/valhalla\/widgets\//,
  /^src\/web\/widgets-api\.ts$/,
  /^test\/(themes-|accueil-|widgets-|maison-|menus-|menu-ordre|barre-bas|fenetre-grille|talos-editeur-cercles|talos-editeur-bulles|talos-editeur-liaisons)[^/]*$/,
];
const AVANT_LE_CHANTIER = new Set(['test/maison-ouvertures.test.ts', 'test/menu-replie.test.ts', 'src/web/pages/menu-replie.js']);
const estChantier = (rel: string) => !AVANT_LE_CHANTIER.has(rel) && CHANTIER.some((r) => r.test(rel));

/** Les fichiers de ce chantier sous une racine (chemins relatifs, avec des /). */
function fichiersDuChantier(racine: string): string[] {
  const out: string[] = [];
  const marcher = (abs: string) => {
    let entrees;
    try { entrees = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entrees) {
      const p = join(abs, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') marcher(p); }
      else if (e.isFile()) { const rel = relative(racine, p).split(sep).join('/'); if (estChantier(rel)) out.push(rel); }
    }
  };
  marcher(join(racine, 'src', 'web'));
  marcher(join(racine, 'src', 'valhalla', 'widgets'));
  marcher(join(racine, 'test'));
  return [...new Set(out)].sort();
}

/** Le texte seul (chaînes et commentaires) d'une source JS/TS/JSON : le code devient des espaces, les lignes restent. */
function texteSeul(src: string): string {
  const out: string[] = [];
  const pile: number[] = [];
  let etat = 'code', prof = 0, i = 0;
  const vide = (c: string) => (c === '\n' ? '\n' : ' ');
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (etat === 'code') {
      if (c === '/' && d === '/') { etat = 'ligne'; out.push('  '); i += 2; continue; }
      if (c === '/' && d === '*') { etat = 'bloc'; out.push('  '); i += 2; continue; }
      if (c === '\'' || c === '"' || c === '`') { etat = c; out.push(' '); i++; continue; }
      if (c === '{') prof++;
      else if (c === '}') {
        if (pile.length && prof === pile[pile.length - 1]) { pile.pop(); etat = '`'; out.push(' '); i++; continue; }
        prof--;
      }
      out.push(vide(c)); i++; continue;
    }
    if (etat === 'ligne') { if (c === '\n') etat = 'code'; out.push(c); i++; continue; }
    if (etat === 'bloc') { if (c === '*' && d === '/') { etat = 'code'; out.push('  '); i += 2; continue; } out.push(c); i++; continue; }
    // dans une chaîne
    if (c === '\\') { out.push(' ', vide(d ?? ' ')); i += 2; continue; }
    if (c === etat) { etat = 'code'; out.push(' '); i++; continue; }
    if (etat === '`' && c === '$' && d === '{') { pile.push(prof); etat = 'code'; out.push('  '); i += 2; continue; }
    if (c === '\n' && etat !== '`') { etat = 'code'; out.push('\n'); i++; continue; }
    out.push(c); i++;
  }
  return out.join('');
}

const ESPACES_NOMS = ['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/1999/xlink', 'http://www.w3.org/XML/1998/namespace'];
const TLD = new Set(('com net org edu gov fr eu io dev co re yt km mg mu sc be ch uk us ca tv xyz online biz ai cloud tech local lan internal localdomain').split(' '));
const IP = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g;
const estIp = (m: RegExpMatchArray) => [m[1], m[2], m[3], m[4]].every((x) => Number(x) <= 255);
const ipExemple = (s: string) => /^(198\.51\.100|192\.0\.2|203\.0\.113)\.\d+$/.test(s);
/** Une source de code (JS, TS, JSON) : les domaines n'y sont cherchés que dans les chaînes et les commentaires. */
const estCode = (rel: string) => /\.(m?[jt]s|c[jt]s|json)$/.test(rel);
const DOMAINE = /(?<![\p{L}\p{N}_.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,24}))(?![\p{L}\p{N}_-]|\.[a-z0-9])/giu;
const domaineExemple = (d: string) => d === 'example.org' || d.endsWith('.example.org');
const HTTP = /\bhttps?:\/\/(\[[^\]]*\]|[^\s'"`/:?#)<>]+)/gi;
const hoteLocal = (h: string) => h === 'localhost' || h === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(h);
const FUSEAU = /\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Z][A-Za-z_+-]*|\b(?:UTC|GMT)\s?[+\-−]\s?\d{1,2}\b|\btimeZone\s*:\s*['"`]/;
const FR_FR = /\bfr[-_]fr\b/i;

/** Les fautes de forme d'une source, ligne par ligne. */
function fautesFormes(rel: string, src: string): Faute[] {
  const essai = rel.startsWith('test/');
  let texte = src;
  for (const u of ESPACES_NOMS) texte = texte.split(u).join(' '.repeat(u.length));
  const net = texte.split('\n');
  // Code : domaines cherchés dans les chaînes et les commentaires seulement. Autre fichier (HTML, Markdown…) : partout.
  const txt = (estCode(rel) ? texteSeul(texte) : texte).split('\n');
  const fautes: Faute[] = [];
  for (let k = 0; k < net.length; k++) {
    const l = net[k], t = txt[k] ?? '';
    const genres = new Set<string>();
    for (const m of l.matchAll(IP)) {
      if (!estIp(m)) continue;
      if (!essai) genres.add('adresse IP écrite en dur');
      else if (!ipExemple(m[0])) genres.add('adresse IP hors des plages d\'exemple');
    }
    for (const m of t.matchAll(DOMAINE)) {
      if (TLD.has(m[2].toLowerCase()) && !domaineExemple(m[1].toLowerCase())) genres.add('nom de domaine autre que example.org');
    }
    if (!essai) {
      for (const m of l.matchAll(HTTP)) if (!hoteLocal(m[1].toLowerCase())) genres.add('adresse http vers l\'extérieur');
      if (FUSEAU.test(l)) genres.add('fuseau horaire écrit en dur');
      if (FR_FR.test(l)) genres.add('fr-FR écrit en dur');
    }
    for (const genre of genres) fautes.push({ fichier: rel, ligne: k + 1, genre });
  }
  return fautes;
}

const verifier = (racine: string) => fichiersDuChantier(racine).flatMap((rel) => fautesFormes(rel, readFileSync(join(racine, rel), 'utf8')));
const dire = (f: Faute[]) => f.map((x) => `${x.fichier}:${x.ligne} ${x.genre}`).join('\n');

test('les fichiers de ce chantier n\'ont ni adresse, ni domaine, ni fuseau, ni fr-FR écrits en dur', (t) => {
  const fichiers = fichiersDuChantier(RACINE);
  t.diagnostic(`${fichiers.length} fichier(s) du chantier lu(s)`);
  const fautes = verifier(RACINE);
  assert.equal(fautes.length, 0, `forme interdite (fichier:ligne genre) :\n${dire(fautes)}`);
});

test('l\'essai des formes s\'essaie lui-même sur deux faux fichiers (un du produit, un essai)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'odin-formes-'));
  try {
    const ecrire = (rel: string, texte: string) => {
      mkdirSync(dirname(join(tmp, rel)), { recursive: true });
      writeFileSync(join(tmp, rel), texte);
    };
    ecrire('src/web/pages/widgets-faux.js', [
      'const ip = \'10.1.2.3\';', // 1 IP
      'const site = "sous.example.com";', // 2 domaine
      'fetch(\'https://example.org/x\');', // 3 http vers l'extérieur (le domaine example.org est admis)
      'const f = new Intl.DateTimeFormat(\'en\', { timeZone: \'Europe/Paris\' });', // 4 fuseau
      'd.toLocaleDateString(\'fr-FR\');', // 5 fr-FR
      'const ns = \'http://www.w3.org/2000/svg\';', // 6 admis
      'const v = texte.fr + noms.com;', // 7 admis : du code, pas une chaîne
      'const l = `${a.b} <a href="/maison">`; // example.org seulement', // 8 admis
      '// voir www.exemple-faux.net', // 9 domaine dans un commentaire
      'const u = \'http://localhost:8080/x\';', // 10 admis
    ].join('\n'));
    ecrire('test/widgets-faux.test.ts', [
      'const a = \'198.51.100.7\', b = \'192.0.2.1\', c = \'203.0.113.9\';', // 1 admis
      'const d = \'http://127.0.0.1:4321/api\';', // 2 IP hors des plages d'exemple (la boucle locale aussi)
      'const e = \'10.0.0.5\';', // 3 IP privée
      'const f = \'https://sous.example.org/\';', // 4 admis
      'const g = \'compte@exemple-faux.net\';', // 5 domaine
      'const h = \'Europe/Paris\';', // 6 admis dans un essai (règle du produit seulement)
    ].join('\n'));
    // Un fichier d'appui qui n'est pas du code : le domaine est cherché dans tout son texte, pas seulement entre guillemets.
    ecrire('test/accueil-faux.md', 'Voir www.exemple-faux.net pour l\'aide.\n');
    // Exclus par leur nom, ou hors du chantier : jamais lus.
    ecrire('test/maison-ouvertures.test.ts', 'const ip = \'10.9.9.9\';\n');
    ecrire('test/menu-replie.test.ts', 'const ip = \'10.9.9.9\';\n');
    ecrire('src/web/pages/menu-replie.js', 'const ip = \'10.9.9.9\';\n');
    ecrire('src/web/pages/autre.js', 'const ip = \'10.9.9.9\';\n');
    ecrire('test/autre.test.ts', 'const ip = \'10.9.9.9\';\n');
    assert.deepEqual(fichiersDuChantier(tmp), ['src/web/pages/widgets-faux.js', 'test/accueil-faux.md', 'test/widgets-faux.test.ts']);
    const vu = verifier(tmp).map((x) => `${x.fichier}:${x.ligne} ${x.genre}`);
    assert.deepEqual(vu, [
      'src/web/pages/widgets-faux.js:1 adresse IP écrite en dur',
      'src/web/pages/widgets-faux.js:2 nom de domaine autre que example.org',
      'src/web/pages/widgets-faux.js:3 adresse http vers l\'extérieur',
      'src/web/pages/widgets-faux.js:4 fuseau horaire écrit en dur',
      'src/web/pages/widgets-faux.js:5 fr-FR écrit en dur',
      'src/web/pages/widgets-faux.js:9 nom de domaine autre que example.org',
      'test/accueil-faux.md:1 nom de domaine autre que example.org',
      'test/widgets-faux.test.ts:2 adresse IP hors des plages d\'exemple',
      'test/widgets-faux.test.ts:3 adresse IP hors des plages d\'exemple',
      'test/widgets-faux.test.ts:5 nom de domaine autre que example.org',
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
