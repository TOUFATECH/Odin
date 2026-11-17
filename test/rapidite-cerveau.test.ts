// Rapidité du Cerveau (src/brain/vault.ts), sans rien changer à ce qu'il rend.
// 1. Écrire une note ne fait plus relire toutes les autres (elles gardent le même objet, déjà analysé).
// 2. Gros Cerveau : rien n'a bougé → aucune re-vérification note par note à chaque demande ; une note corrigée à la
//    main est vue tout de suite (surveillance du dossier).
// 3. La recherche rend exactement les mêmes notes, scores et extraits qu'un balayage de référence ; aucun découpage
//    (split) des notes pendant la recherche.
// RAPIDITE_VAULT : chemin d'une autre copie de vault.ts (pour rejouer l'essai sur l'ancienne version).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const chemin = process.env.RAPIDITE_VAULT ? pathToFileURL(process.env.RAPIDITE_VAULT).href : '../src/brain/vault.ts';
const { Vault } = await import(chemin) as typeof import('../src/brain/vault.ts');

const MOTS = 'sauvegarde serveur imprimante réseau facture électricité banque projet boutique routeur caméra jardin budget épargne crédit maison travaux disque stockage photo réunion rapport commande livraison panne réparation'.split(' ');
function coffre(n: number): string {
  const root = mkdtempSync(join(tmpdir(), 'odin-rapidite-cerveau-'));
  let a = 7; const r = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
  for (let i = 0; i < n; i++) {
    const d = ['Projets', 'Idées', 'Journal', ''][i % 4]; mkdirSync(join(root, d), { recursive: true });
    const phr = Array.from({ length: 30 + Math.floor(r() * 40) }, () => MOTS[Math.floor(r() * MOTS.length)]).join(' ');
    writeFileSync(join(root, d, `note ${i}.md`), `---\ntype: note\n---\n# Note ${i}\n\n${phr}. ${phr}.\n\nVoir [[note ${(i + 1) % n}]].\n`);
  }
  return root;
}
const fermer = (v: unknown, root: string) => { try { (v as { arreterVeille?: () => void }).arreterVeille?.(); } catch { /* */ } try { rmSync(root, { recursive: true, force: true, maxRetries: 5 }); } catch { /* */ } };

test('écrire une note ne fait pas relire les autres', () => {
  const root = coffre(50); const v = new Vault(root);
  try {
    const autre = v.find('Projets/note 4');
    assert.ok(autre);
    v.write('Journal/nouvelle', { type: 'journal' }, '# Nouvelle\n\nune ligne');
    assert.equal(v.find('Projets/note 4'), autre, 'la note non touchée doit rester le même objet (pas relue)');
    v.write('Projets/note 4', { type: 'note' }, '# Note 4\n\nTexte changé.');
    assert.match(v.find('Projets/note 4')!.body, /Texte changé/, 'la note écrite est relue pour de bon');
    assert.ok(v.find('Journal/nouvelle'));
  } finally { fermer(v, root); }
});

const dormir = (ms: number) => new Promise((x) => setTimeout(x, ms));
/** Attend que la surveillance du dossier soit posée (la vérification du type de disque se fait à part). */
async function surveillance(v: unknown): Promise<boolean> {
  for (let i = 0; i < 60; i++) { const w = (v as { veille?: unknown }).veille; if (w) return true; if (w === null) return false; (v as { all(f?: boolean): unknown }).all(true); await dormir(100); }
  return false;
}

test('gros Cerveau : pas de re-vérification note par note quand rien ne bouge (surveillance qui a fait ses preuves)', async () => {
  const root = coffre(320); const v = new Vault(root);
  const stat0 = fs.statSync; let stats = 0;
  (fs as unknown as { statSync: unknown }).statSync = (...a: unknown[]) => { stats++; return (stat0 as (...x: unknown[]) => unknown)(...a); };
  syncBuiltinESMExports();
  try {
    v.all(); await surveillance(v);
    v.write('Journal/preuve', { type: 'journal' }, '# Preuve\n\nOdin écrit une note : la surveillance la signale.');
    await dormir(400); v.all();
    await dormir(3200);
    stats = 0; v.search('sauvegarde serveur', 10);
    assert.ok(stats < 10, `au-delà de 3 s sans changement : ${stats} vérifications de note (attendu : presque aucune)`);
  } finally { (fs as unknown as { statSync: unknown }).statSync = stat0; syncBuiltinESMExports(); fermer(v, root); }
});

test('une correction à la main JUSTE APRÈS une vraie relecture est vue sans attendre 3 s', async () => {
  const root = coffre(320); const v = new Vault(root);
  try {
    v.all(); assert.ok(await surveillance(v), 'surveillance non posée (disque réseau ?)');
    for (const k of [1, 2, 3]) {
      v.all(true); // une vraie relecture, toute fraîche
      writeFileSync(join(root, 'Projets', 'note 1.md'), `---\ntype: note\n---\n# Note 1\n\nCorrigée à la main, version ${k}.\n`);
      await dormir(400);
      assert.match(v.find('Projets/note 1')?.body ?? '', new RegExp(`version ${k}`), `correction ${k} vue 400 ms après`);
    }
  } finally { fermer(v, root); }
});

test('le dossier du Cerveau déplacé puis remplacé : le nouveau contenu est vu au moins aussi vite qu\'avant (3,5 s)', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'odin-rapidite-deplace-'));
  const src = coffre(320), root = join(parent, 'cerveau'), copie = join(parent, 'copie');
  fs.cpSync(src, root, { recursive: true }); fs.cpSync(src, copie, { recursive: true }); rmSync(src, { recursive: true, force: true });
  const v = new Vault(root);
  try {
    v.all(); assert.ok(await surveillance(v));
    v.write('Journal/preuve', { type: 'journal' }, '# Preuve\n\nune ligne'); await dormir(400); v.all(); // surveillance prouvée
    writeFileSync(join(copie, 'Projets', 'note 1.md'), '---\ntype: note\n---\n# Note 1\n\nVersion de la sauvegarde.\n');
    fs.renameSync(root, join(parent, 'ancien')); fs.renameSync(copie, root);
    await dormir(3500);
    assert.match(v.find('Projets/note 1')?.body ?? '', /Version de la sauvegarde/, 'le contenu du dossier remis doit être vu en 3,5 s au plus');
  } finally { fermer(v, root); try { rmSync(parent, { recursive: true, force: true, maxRetries: 5 }); } catch { /* */ } }
});

test('un chemin réseau n\'est jamais surveillé (relecture toutes les 3 s, comme avant)', async () => {
  const m = await import(chemin) as { disqueReseau?: (r: string) => Promise<boolean> };
  assert.ok(m.disqueReseau, 'détection du disque réseau absente');
  assert.equal(await m.disqueReseau!('\\\\serveur\\partage\\cerveau'), true);
});

test('la recherche rend les mêmes notes, scores et extraits qu\'un balayage de référence, sans découper les notes', () => {
  const root = coffre(200); const v = new Vault(root);
  try {
    const cle = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.md$/, '').trim();
    // Référence : l'algorithme d'origine (balayage de toutes les notes, extrait pour chacune).
    const reference = (q: string, limit: number, now: number) => {
      const words = cle(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
      const out: Array<{ path: string; score: number; snippet: string }> = [];
      for (const n of v.all()) {
        const title = cle(n.title), body = cle(n.body), props = cle(JSON.stringify(n.meta)), tags = n.tags.join(' ');
        let score = 0, hit = -1;
        for (const w of words) { if (title.includes(w)) score += 10; if (tags.includes(w)) score += 5; if (props.includes(w)) score += 3; const i = body.indexOf(w); if (i >= 0) { score += 2 + Math.min(3, body.split(w).length - 2); if (hit < 0) hit = i; } }
        if (!score) continue;
        if (words.every((w) => title.includes(w) || body.includes(w))) score += 5;
        score += Math.max(0, 3 - (now - n.mtime) / (30 * 86_400_000));
        const raw = n.body.replace(/\s+/g, ' '), at = hit >= 0 ? Math.max(0, hit - 60) : 0;
        out.push({ path: n.path, score, snippet: `${at > 0 ? '…' : ''}${raw.slice(at, at + 200).trim()}${raw.length > at + 200 ? '…' : ''}` });
      }
      return out.sort((a, b) => b.score - a.score).slice(0, limit);
    };
    // Ex aequo : l'ordre entre notes de même score dépend de l'ordre de parcours (déjà vrai avant) ; on compare donc
    // la liste complète triée par score puis par chemin, et, pour les 20 premières, la suite exacte des scores.
    const tri = (l: Array<{ path: string; score: number; snippet: string }>) => l.map((x) => `${x.score.toFixed(6)}|${x.path}|${x.snippet}`).sort().reverse();
    const verifier = (q: string) => {
      const ref = reference(q, 100000, Date.now()), obtenu = v.search(q, 100000).map((x) => ({ path: x.note.path, score: x.score, snippet: x.snippet }));
      assert.deepEqual(tri(obtenu), tri(ref), `résultats différents pour « ${q} »`);
      assert.deepEqual(v.search(q, 20).map((x) => x.score.toFixed(6)), ref.slice(0, 20).map((x) => x.score.toFixed(6)), `scores des 20 premières différents pour « ${q} »`);
    };
    for (const q of ['sauvegarde serveur', 'facture électricité banque', 'note 12', 'jardin', 'xyzzy introuvable', 'panne réparation livraison']) verifier(q);
    // Après l'écriture d'une note, toujours identique (index mis à jour sans tout reconstruire).
    v.write('Idées/aquarelle', { type: 'idée' }, '# Aquarelle\n\nsauvegarde des aquarelles sur le serveur');
    verifier('aquarelle serveur'); verifier('sauvegarde serveur');
    // Aucune note découpée pendant la recherche.
    const split0 = String.prototype.split; let decoupes = 0;
    String.prototype.split = function (this: string, ...a: unknown[]) { if (this.length > 300) decoupes++; return (split0 as (...x: unknown[]) => string[]).apply(this, a); } as typeof String.prototype.split;
    try { v.search('sauvegarde serveur stockage', 20); } finally { String.prototype.split = split0; }
    assert.equal(decoupes, 0, `${decoupes} notes découpées pendant la recherche`);
  } finally { fermer(v, root); }
});
