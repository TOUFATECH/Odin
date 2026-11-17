// Mathésis — lot 4 : le réseau de la maison. Odin ne lit QUE les dossiers ouverts par le propriétaire, en lecture seule :
// un fichier lu a la même empreinte avant et après ; un dossier non ouvert, une jonction ou un lien vers l'extérieur, un
// dossier interdit ne sont jamais lus ; un fichier inchangé n'est pas relu ; le budget tient ; un document est lu page par page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { creerMathesis } from '../src/valhalla/mathesis/moteur.ts';
import { MagasinMemoire } from '../src/valhalla/mathesis/magasin.ts';
import { dedans, parties } from '../src/valhalla/mathesis/maison.ts';
import { createPdf } from '../src/files/pdf.ts';
import type { Apport } from '../src/learn/apprendre-de-tout.ts';
import { fausseHorloge } from './mathesis-outils-essai.ts';

const PAGE = (n: number) => `Page ${n} : le jardin créole de la maison donne des brèdes, des piments et des citrons toute l'année.`;

function monterMaison(o: { budgets?: Record<string, number>; nePasGarder?: boolean; oeil?: boolean; occupe?: () => boolean } = {}) {
  const racine = mkdtempSync(join(tmpdir(), 'mathesis-maison-'));
  const ouvert = join(racine, 'ouvert'), dehors = join(racine, 'dehors');
  mkdirSync(join(ouvert, 'sous'), { recursive: true }); mkdirSync(join(ouvert, 'prive'), { recursive: true }); mkdirSync(dehors, { recursive: true });
  writeFileSync(join(ouvert, 'jardin.txt'), [PAGE(1), PAGE(2), PAGE(3)].join('\f'));
  writeFileSync(join(ouvert, 'sous', 'notes.md'), `# Notes\n\n${PAGE(9)}`);
  writeFileSync(join(ouvert, 'guide.pdf'), createPdf(Array.from({ length: 120 }, (_, i) => `Ligne ${i} : le guide du jardin créole explique comment arroser les brèdes le soir.`).join('\n\n'), 'Guide'));
  writeFileSync(join(ouvert, 'photo.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(join(ouvert, 'prive', 'journal-intime.txt'), 'SECRET-INTERDIT : ce dossier est interdit par le propriétaire.');
  writeFileSync(join(dehors, 'secret.txt'), 'SECRET-DEHORS : ce dossier n\'est pas ouvert.');
  // Une jonction (aucun droit spécial requis sous Windows) qui mène HORS du dossier ouvert.
  symlinkSync(dehors, join(ouvert, 'raccourci-dehors'), 'junction');
  // Un lien de fichier relatif « ../dehors/secret.txt » (peut demander un droit sous Windows : essayé si possible).
  let lienFichier = false;
  try { symlinkSync(join('..', 'dehors', 'secret.txt'), join(ouvert, 'evasion.txt'), 'file'); lienFichier = true; } catch { /* droit refusé : ce cas n'est pas essayé */ }
  const h = fausseHorloge(new Date(2026, 10, 17, 14, 0).getTime());
  const apports: Apport[] = [];
  const m = creerMathesis({
    dossier: racine, home: racine, magasin: new MagasinMemoire(), temps: { maintenant: h.maintenant, attendre: h.attendre },
    chercher: async () => [], transport: async () => { throw new Error('aucun réseau dans cet essai'); },
    apprentissage: (a) => { apports.push(a); return { retenus: a.faits?.length ?? 0, ignores: 0, rejetes: 0, souvenirs: [1], niveaux: [] }; },
    occupe: o.occupe,
    lireImage: () => (o.oeil ? async () => 'Texte lu sur la photo : récolte des brèdes du jardin créole, samedi matin.' : undefined),
  });
  m.regler({ dossiers: [ouvert], nePasGarder: o.nePasGarder === true, ...(o.budgets ? { budgets: { ...m.reglages().budgets, ...o.budgets } } : {}) });
  m.interdits.interdire('dossiers', join(ouvert, 'prive'));
  const empreintes = () => {
    const out: Record<string, string> = {};
    const tour = (d: string) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory() && !n.isSymbolicLink()) tour(p); else if (n.isFile()) { const st = statSync(p); out[p] = `${createHash('sha256').update(readFileSync(p)).digest('hex')}:${st.mtimeMs}:${st.size}`; } } };
    tour(ouvert); tour(dehors);
    return out;
  };
  return { racine, ouvert, dehors, m, apports, h, lienFichier, empreintes, fermer: () => rmSync(racine, { recursive: true, force: true }) };
}

test('dedans / parties : purs', () => {
  const r = join(tmpdir(), 'ouvert');
  assert.equal(dedans(join(r, 'a', 'b.txt'), r), true);
  assert.equal(dedans(r, r), true);
  assert.equal(dedans(resolve(r, '..', 'dehors', 'x.txt'), r), false, '« .. » ne sort pas');
  assert.equal(dedans(`${r}-voisin`, r), false, 'un dossier voisin au nom proche n\'est pas dedans');
  assert.deepEqual(parties('a\fb\f\fc'), ['a', 'b', 'c']);
  assert.equal(parties('x'.repeat(9000), 4000).length, 3);
});

test('lecture seule et jamais ailleurs : empreintes identiques, dehors et interdit jamais lus, jonction refusée', async () => {
  const x = monterMaison();
  try {
    const avant = x.empreintes();
    const b = await x.m.maison.parcourir();
    assert.equal(b.arret, undefined);
    assert.deepEqual(x.empreintes(), avant, 'aucun fichier modifié, ni dans le dossier ouvert ni dehors');
    const lus = Object.keys(x.m.maison.etats());
    assert.equal(lus.some((p) => p.startsWith(x.dehors) || p.includes('prive')), false, JSON.stringify(lus));
    const tout = JSON.stringify(x.apports);
    assert.doesNotMatch(tout, /SECRET-DEHORS|SECRET-INTERDIT/);
    assert.ok(b.refuses.some((r) => r.chemin.endsWith('raccourci-dehors')), 'la jonction vers l\'extérieur est refusée');
    if (x.lienFichier) assert.ok(b.refuses.some((r) => r.chemin.endsWith('evasion.txt')), 'le lien « ../dehors » est refusé');
    // Les fichiers du dossier ouvert ont été lus (texte, markdown du sous-dossier, PDF), l'image est dite pas lue.
    assert.equal(b.lus, 3);
    assert.ok(b.pasLus.some((p) => p.chemin.endsWith('photo.png') && /œil/.test(p.raison)));
    assert.ok(x.apports.every((a) => a.source.startsWith('fichier:') && typeof a.date === 'number'));
  } finally { x.fermer(); }
});

test('un document est lu page par page (sauts de page ; PDF découpé et dit approximatif)', async () => {
  const x = monterMaison();
  try {
    await x.m.maison.parcourir();
    const j = x.m.journal.lire();
    assert.ok(j.some((e) => /jardin\.txt.*3 page\(s\)/.test(e.quoi)), JSON.stringify(j.map((e) => e.quoi)));
    const pdf = j.find((e) => /guide\.pdf/.test(e.quoi));
    assert.ok(pdf);
    assert.match(pdf!.quoi, /page\(s\)/);
    const jardin = x.apports.find((a) => a.source === 'fichier:jardin.txt')!;
    assert.equal(jardin.faits?.length, 3, 'une phrase retenue par page');
    assert.match(jardin.faits![1].texte, /^Page 2/);
  } finally { x.fermer(); }
});

test('un fichier inchangé n\'est pas relu ; une date changée sans contenu nouveau n\'est pas réanalysée ; un contenu changé l\'est', async () => {
  const x = monterMaison();
  try {
    await x.m.maison.parcourir();
    const n = x.apports.length, fichiers = x.m.budget.utilise().fichiers;
    const b2 = await x.m.maison.parcourir();
    assert.equal(b2.lus, 0);
    assert.equal(x.apports.length, n);
    assert.equal(x.m.budget.utilise().fichiers, fichiers, 'rien rouvert : aucun budget dépensé');
    const f = join(x.ouvert, 'jardin.txt');
    const t = new Date(2026, 10, 18, 10, 0); utimesSync(f, t, t);
    const b3 = await x.m.maison.parcourir();
    assert.equal(b3.lus, 0);
    assert.equal(x.apports.length, n, 'même empreinte : pas réanalysé');
    writeFileSync(f, [PAGE(1), PAGE(4)].join('\f'));
    const b4 = await x.m.maison.parcourir();
    assert.equal(b4.lus, 1);
    assert.equal(x.apports.length, n + 1);
  } finally { x.fermer(); }
});

test('budget de fichiers par jour : essayer de le dépasser arrête la lecture', async () => {
  const x = monterMaison({ budgets: { fichiers: 1 } });
  try {
    const b = await x.m.maison.parcourir();
    assert.equal(b.lus, 1);
    assert.equal(b.arret, 'budget');
    assert.equal(x.m.budget.restant('fichiers'), 0);
    const b2 = await x.m.maison.parcourir();
    assert.equal(b2.lus, 0);
  } finally { x.fermer(); }
  const y = monterMaison({ budgets: { octetsFichiers: 10 } });
  try {
    const b = await y.m.maison.parcourir();
    assert.equal(b.lus, 0);
    assert.equal(b.arret, 'budget');
  } finally { y.fermer(); }
});

test('aucun dossier ouvert par défaut : le tour ne lit rien ; « ne pas garder » : rien n\'est rangé ; l\'œil prêt lit l\'image', async () => {
  const racine = mkdtempSync(join(tmpdir(), 'mathesis-maison-vide-'));
  try {
    const m = creerMathesis({ dossier: racine, home: racine, magasin: new MagasinMemoire(), chercher: async () => [], transport: async () => { throw new Error('non'); } });
    assert.deepEqual(m.reglages().dossiers, []);
    const b = await m.tour();
    assert.equal(b.maison, undefined);
    assert.deepEqual(m.maison.etats(), {});
  } finally { rmSync(racine, { recursive: true, force: true }); }
  const x = monterMaison({ nePasGarder: true });
  try {
    const b = await x.m.maison.parcourir();
    assert.equal(b.lus, 3);
    assert.equal(x.apports.length, 0);
  } finally { x.fermer(); }
  const y = monterMaison({ oeil: true });
  try {
    const b = await y.m.maison.parcourir();
    assert.equal(b.lus, 4);
    assert.ok(y.apports.some((a) => a.source === 'fichier:photo.png'));
  } finally { y.fermer(); }
});

test('le passage s\'arrête dès qu\'Odin doit répondre, et l\'interrupteur coupé ne lit rien', async () => {
  const x = monterMaison();
  try {
    x.m.eteindre();
    const b = await x.m.maison.parcourir();
    assert.equal(b.arret, 'eteint');
    assert.equal(b.lus, 0);
  } finally { x.fermer(); }
  let occupe = false, n = 0;
  const y = monterMaison({ occupe: () => { n++; if (n > 4) occupe = true; return occupe; } });
  try {
    const b = await y.m.maison.parcourir();
    assert.equal(b.arret, 'occupe');
    assert.ok(b.lus < 3, `lus avant l'arrêt : ${b.lus}`);
  } finally { y.fermer(); }
});
