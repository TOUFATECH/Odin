// Garde-fou des données d'exemple de la maquette de l'accueil (filet 1 du lot 0). Le dépôt est public : aucun prénom,
// site, localité, machine, adresse ou titre de la maquette n'y entre. Les mots interdits ne sont PAS ici : seulement
// leurs empreintes (HMAC-SHA-256 avec une clé gardée hors du dépôt) dans donnees-exemple.empreintes.json, en deux
// listes. Liste A : interdits dans tous les fichiers de texte de src/ et test/. Liste B (des mots déjà présents
// ailleurs dans le dépôt) : interdits dans les fichiers de ce chantier, reconnus par leur nom. Une trouvaille donne le
// fichier, la ligne et le rang de l'empreinte, jamais le mot. Sans la clé (ODIN_GARDE_CLE), l'essai principal ne peut
// pas tourner et le dit ; l'essai de lui-même, avec une clé et des mots d'essai, tourne partout.
// Limites : il reconnaît le mot exact (sans casse ni accents), pas une tournure voisine ; un groupe de mots ne
// passe pas d'une ligne à l'autre ; des mots joints par une majuscule ou un chiffre (motMot, MOTMot, mot2) sont
// reconnus, mais deux mots collés sans majuscule (motmot) ne le sont pas.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

type Entree = { n: number; e: string };
type Empreintes = { controle: string; tetes: string[]; A: Entree[]; B: Entree[] };
type Trouvaille = { fichier: string; ligne: number; liste: 'A' | 'B'; rang: number };

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTROLE = 'controle-de-la-cle';

/** Minuscules, sans accents ni ligatures. */
function forme(s: string): string {
  if (/^[\x00-\x7f]*$/.test(s)) return s.toLowerCase(); // même résultat, plus vite
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss');
}
/** Les mots d'une ligne mise en forme : lettres et chiffres de toutes les écritures. */
const decouper = (l: string) => l.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Une ligne brute dont les mots joints par une majuscule ou un chiffre (motMot, MOTMot, mot2) sont séparés ; avant la mise en forme. */
const casser = (l: string) => l.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
  .replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2');
/** Les noms de domaine et adresses IP entiers d'une ligne mise en forme, et leurs domaines parents. */
function adresses(l: string): Set<string> {
  const out = new Set<string>();
  for (const m of l.matchAll(/[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu)) {
    const parts = m[0].replace(/^-+|-+$/g, '').split('.').filter(Boolean);
    for (let i = 0; i + 1 < parts.length; i++) out.add(parts.slice(i).join('.'));
  }
  return out;
}
const empreinte = (cle: string, s: string) => createHmac('sha256', cle).update(s, 'utf8').digest('hex');

// Les fichiers de ce chantier (filet 2 du plan) : fichiers neufs du produit et essais neufs, reconnus par leur nom ;
// trois fichiers d'avant le chantier portent un de ces noms et sont exclus. Même liste que chantier13-formes.test.ts.
const CHANTIER = [
  /^src\/web\/pages\/(themes|accueil|widgets|maison)-[^/]*\.js$/,
  /^src\/web\/pages\/menu-ecrans\.js$/,
  /^src\/valhalla\/widgets\//,
  /^src\/web\/widgets-api\.ts$/,
  /^test\/(themes-|accueil-|widgets-|maison-|menus-|menu-ordre|barre-bas|fenetre-grille|talos-editeur-cercles|talos-editeur-bulles|talos-editeur-liaisons)[^/]*$/,
];
const AVANT_LE_CHANTIER = new Set(['test/maison-ouvertures.test.ts', 'test/menu-replie.test.ts', 'src/web/pages/menu-replie.js']);
const estChantier = (rel: string) => !AVANT_LE_CHANTIER.has(rel) && CHANTIER.some((r) => r.test(rel));

const BINAIRES = /\.(gz|zip|webp|png|jpe?g|gif|ico|woff2?|ttf|otf|pdf|mp[34]|ogg|wav|webm|docx|xlsx|pptx|onnx|bin|wasm)$/i;
/** Les fichiers de texte de src/ et test/ sous une racine (chemins relatifs, avec des /). */
function fichiersTexte(racine: string): string[] {
  const out: string[] = [];
  const marcher = (abs: string) => {
    let entrees;
    try { entrees = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entrees) {
      const p = join(abs, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') marcher(p); }
      else if (e.isFile() && !BINAIRES.test(e.name)) out.push(relative(racine, p).split(sep).join('/'));
    }
  };
  for (const d of ['src', 'test']) marcher(join(racine, d));
  return out.sort();
}

/** Cherche les empreintes dans src/ et test/ sous `racine`. Ne rend jamais un mot : fichier, ligne, liste, rang. */
async function fouiller(racine: string, cle: string, E: Empreintes): Promise<Trouvaille[]> {
  // Lecture en parallèle : le dépôt peut être sur un partage réseau, où lire un fichier après l'autre est lent.
  const noms = fichiersTexte(racine);
  const contenus = new Array<Buffer>(noms.length);
  let suivant = 0;
  await Promise.all(Array.from({ length: 32 }, async () => {
    while (suivant < noms.length) { const k = suivant++; contenus[k] = await readFile(join(racine, noms[k])); }
  }));
  const rangs = { A: new Map<string, number>(), B: new Map<string, number>() };
  E.A.forEach((x, i) => rangs.A.set(x.e, i + 1));
  E.B.forEach((x, i) => rangs.B.set(x.e, i + 1));
  const tailles = new Set([...E.A, ...E.B].map((x) => x.n));
  const tetes = new Set(E.tetes);
  const memo = new Map<string, string>();
  const h = (s: string) => { let v = memo.get(s); if (v === undefined) { v = empreinte(cle, s); memo.set(s, v); } return v; };
  const trouvailles: Trouvaille[] = [];
  for (let n = 0; n < noms.length; n++) {
    const fichier = noms[n], brut = contenus[n];
    if (brut.indexOf(0) !== -1) continue; // binaire
    const listes: ('A' | 'B')[] = estChantier(fichier) ? ['A', 'B'] : ['A'];
    const lignes = brut.toString('utf8').split('\n');
    for (let k = 0; k < lignes.length; k++) {
      const f = forme(lignes[k]);
      const vus = new Set<string>();
      const voir = (e: string) => {
        for (const l of listes) {
          const r = rangs[l].get(e);
          if (r && !vus.has(l + r)) { vus.add(l + r); trouvailles.push({ fichier, ligne: k + 1, liste: l, rang: r }); }
        }
      };
      const groupes = (mots: string[]) => {
        for (let i = 0; i < mots.length; i++) {
          const e1 = h(mots[i]);
          voir(e1);
          if (!tetes.has(e1)) continue;
          if (tailles.has(2) && i + 1 < mots.length) voir(h(mots[i] + ' ' + mots[i + 1]));
          if (tailles.has(3) && i + 2 < mots.length) voir(h(mots[i] + ' ' + mots[i + 1] + ' ' + mots[i + 2]));
        }
      };
      groupes(decouper(f));
      // Les mots joints dans un identifiant : la ligne est relue, coupée aux majuscules.
      const c = casser(lignes[k]);
      if (c !== lignes[k]) groupes(decouper(forme(c)));
      if (tailles.has(0) && f.includes('.')) for (const a of adresses(f)) voir(h(a));
    }
  }
  return trouvailles;
}

const dire = (t: Trouvaille[]) => t.map((x) => `${x.fichier}:${x.ligne} liste ${x.liste} rang ${x.rang}`).join('\n');

test('aucune donnée d\'exemple de la maquette dans src/ ni dans test/ (empreintes, clé hors du dépôt)', async (t) => {
  const cle = (process.env.ODIN_GARDE_CLE ?? '').trim();
  if (!cle) {
    t.diagnostic('non joué : clé absente (ODIN_GARDE_CLE)');
    t.skip('non joué : clé absente');
    return;
  }
  const E = JSON.parse(readFileSync(join(RACINE, 'test/donnees-exemple.empreintes.json'), 'utf8')) as Empreintes;
  assert.equal(empreinte(cle, CONTROLE), E.controle, 'la clé donnée n\'est pas celle des empreintes');
  const t0 = Date.now();
  // Une seule exception, étroite : un nom de lieu (liste B, rang 4) qui est aussi le nom d'un thème déjà public dans le
  // dépôt (thème d'Odin et thème de l'écran de la maison) ; le catalogue des thèmes le reprend tel quel. Ailleurs dans
  // les fichiers du chantier, et pour tout autre rang, la règle reste entière.
  const PERMIS = new Set(['src/web/pages/themes-catalogue.js:B4']);
  const trouvailles = (await fouiller(RACINE, cle, E)).filter((x) => !PERMIS.has(`${x.fichier}:${x.liste}${x.rang}`));
  t.diagnostic(`${E.A.length} empreintes en liste A, ${E.B.length} en liste B ; ${Date.now() - t0} ms`);
  assert.equal(trouvailles.length, 0, `donnée d'exemple de la maquette trouvée (fichier:ligne, liste, rang de l'empreinte) :\n${dire(trouvailles)}`);
});

test('l\'essai s\'essaie lui-même : clé d\'essai et trois mots neutres dans un dossier temporaire', async () => {
  const cle = 'cle-d-essai-du-garde-fou';
  // Trois mots inventés : un mot seul et un groupe de trois mots en liste A, un nom de domaine en liste B.
  const motA = 'zéphyrinade', groupeA = 'vallée des brumes', domaineB = 'neutre-essai.example.org';
  const entrees = [motA, groupeA].map((m) => ({ n: decouper(forme(m)).length, e: empreinte(cle, decouper(forme(m)).join(' ')) }));
  const E: Empreintes = {
    controle: empreinte(cle, CONTROLE),
    tetes: [empreinte(cle, 'vallee')],
    A: entrees.sort((a, b) => (a.e < b.e ? -1 : 1)),
    B: [{ n: 0, e: empreinte(cle, domaineB) }],
  };
  const rangA = (m: string) => E.A.findIndex((x) => x.e === empreinte(cle, decouper(forme(m)).join(' '))) + 1;
  const tmp = mkdtempSync(join(tmpdir(), 'odin-garde-'));
  try {
    const ecrire = (rel: string, texte: string) => {
      mkdirSync(dirname(join(tmp, rel)), { recursive: true });
      writeFileSync(join(tmp, rel), texte);
    };
    ecrire('src/propre.ts', 'export const a = 1; // rien à trouver ici, ni vallée ni brumes séparées\n');
    ecrire('src/ailleurs.ts', 'const x = 1;\nconst nom = "ZEPHYRINADE";\nconst s = "https://sous.neutre-essai.example.org/x";\n'
      // Dans un identifiant : mots joints par des majuscules (motMot, MOTMot).
      + 'let estZephyrinade = 1;\nconst laValléeDesBrumes = 2;\nconst ZEPHYRINADEValeur = 3;\nconst zéphyrinade2 = 4;\n');
    ecrire('src/web/pages/widgets-faux.js', 'const t = 1;\nconst titre = `La Vallée  des Brumes`;\nconst u = "neutre-essai.example.org";\n');
    ecrire('test/autre-essai.test.ts', '// neutre-essai.example.org hors du chantier : liste B non cherchée ici\n');
    ecrire('test/widgets-faux.test.ts', 'a\nb\nc\nconst site = "www.neutre-essai.example.org";\n');
    ecrire('src/image.png', 'zéphyrinade');
    const t = await fouiller(tmp, cle, E);
    const vu = t.map((x) => `${x.fichier}:${x.ligne}:${x.liste}${x.rang}`).sort();
    assert.deepEqual(vu, [
      `src/ailleurs.ts:2:A${rangA(motA)}`,
      `src/ailleurs.ts:4:A${rangA(motA)}`,
      `src/ailleurs.ts:5:A${rangA(groupeA)}`,
      `src/ailleurs.ts:6:A${rangA(motA)}`,
      `src/ailleurs.ts:7:A${rangA(motA)}`,
      `src/web/pages/widgets-faux.js:2:A${rangA(groupeA)}`,
      'src/web/pages/widgets-faux.js:3:B1',
      'test/widgets-faux.test.ts:4:B1',
    ]);
    // La sortie ne donne jamais le mot.
    const sortie = forme(dire(t));
    for (const m of [motA, groupeA, domaineB, 'zephyrinade', 'vallee', 'brumes', 'neutre-essai']) assert.ok(!sortie.includes(forme(m)), 'aucun mot dans la sortie');
    // Une autre clé ne retrouve rien : sans la bonne clé, une empreinte ne dit rien.
    assert.equal((await fouiller(tmp, 'une-autre-cle', E)).length, 0);
    assert.notEqual(empreinte('une-autre-cle', CONTROLE), E.controle);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/** Le bloc qui dit les fichiers de ce chantier dans une source, sans commentaires ni espaces. */
function blocChantier(src: string): string {
  const debut = src.indexOf('const CHANTIER = ['), fin = src.indexOf('const estChantier');
  assert.ok(debut >= 0 && fin > debut, 'bloc des fichiers du chantier introuvable');
  return src.slice(debut, fin).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
}

test('la liste des fichiers du chantier est la même que dans chantier13-formes.test.ts', () => {
  const ici = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const formes = readFileSync(join(RACINE, 'test/chantier13-formes.test.ts'), 'utf8');
  assert.equal(blocChantier(formes), blocChantier(ici), 'les deux essais doivent reconnaître les mêmes fichiers du chantier');
});

test('les empreintes du dépôt : deux listes, sans aucun mot lisible', () => {
  const texte = readFileSync(join(RACINE, 'test/donnees-exemple.empreintes.json'), 'utf8');
  const E = JSON.parse(texte) as Empreintes;
  assert.match(E.controle, /^[0-9a-f]{64}$/);
  assert.ok(E.A.length + E.B.length > 0, 'au moins une empreinte');
  for (const x of [...E.A, ...E.B]) {
    assert.match(x.e, /^[0-9a-f]{64}$/);
    assert.ok([0, 1, 2, 3].includes(x.n), 'taille de groupe 0 (adresse entière), 1, 2 ou 3');
  }
  for (const e of E.tetes) assert.match(e, /^[0-9a-f]{64}$/);
});
