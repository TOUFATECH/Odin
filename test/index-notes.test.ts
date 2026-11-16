// Lot B « répondre vite » : l'index inversé des notes du Cerveau donne les mêmes résultats que le balayage,
// se met à jour à l'écriture (via vaultEvents), et n'écarte jamais une note qui contient un mot cherché.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { IndexNotes } from '../src/brain/index-notes.ts';
import { Vault, vaultEvents, type Note } from '../src/brain/vault.ts';

const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Référence : une note « matche » une demande si un mot cherché est une sous-chaîne (comme vault.search). */
function brute(n: Note, query: string): boolean {
  const mots = fold(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  const title = fold(n.title), body = fold(n.body), props = fold(JSON.stringify(n.meta)), tags = n.tags.join(' ');
  return mots.some((w) => title.includes(w) || body.includes(w) || props.includes(w) || tags.includes(w));
}

function neuf(): { v: Vault; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'odin-idx-'));
  return { v: new Vault(dir), cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }) };
}

test('candidats ne rate aucune note qui contient un mot cherché (sur-ensemble du balayage)', () => {
  const { v, cleanup } = neuf();
  try {
    v.write('Serveur de fichiers', { type: 'note' }, 'Le NAS répond sur le port 8080. Sauvegarde chaque nuit.');
    v.write('Routeur', { type: 'note', ip: '192.168.1.1' }, 'La box et le réseau wifi, redémarrage mensuel.');
    v.write('Chat', { type: 'note' }, 'Pixel mange à 8 h. Vétérinaire en mars.');
    v.write('Onduleur', { type: 'note' }, 'Protège le serveur des coupures.');
    const index = new IndexNotes(); index.construire(v.all());
    for (const q of ['serveur', 'redemarrage reseau', 'pixel chat', 'port 8080', 'coupure serveur', 'introuvable xyz']) {
      const cand = new Set(index.candidats(q).map((n) => n.path));
      const attendu = v.all().filter((n) => brute(n, q)).map((n) => n.path);
      for (const p of attendu) assert.ok(cand.has(p), `« ${q} » : la note ${p} doit être candidate`);
    }
  } finally { cleanup(); }
});

test('vault.search (via l\'index) rend les bons résultats, classés', () => {
  const { v, cleanup } = neuf();
  try {
    v.write('Serveur de fichiers', { type: 'note' }, 'Le serveur de fichiers (NAS) répond sur le port 8080.');
    v.write('Routeur', { type: 'note' }, 'Le routeur distribue le réseau.');
    v.write('Recette', { type: 'note' }, 'Gâteau au chocolat.');
    const r = v.search('serveur fichiers', 10);
    assert.ok(r.length >= 1, 'au moins une note trouvée');
    assert.equal(r[0].note.title, 'Serveur de fichiers', 'la note la plus pertinente est en tête');
    assert.ok(!r.some((x) => x.note.title === 'Recette'), 'une note sans rapport n\'est pas renvoyée');
    assert.equal(v.search('xyzinconnu', 10).length, 0, 'une demande sans correspondance ne rend rien');
  } finally { cleanup(); }
});

test('l\'index se met à jour à l\'écriture, au renommage et à la corbeille (vaultEvents)', () => {
  const { v, cleanup } = neuf();
  try {
    v.write('Première', { type: 'note' }, 'contenu initial');
    const index = new IndexNotes(); index.construire(v.all());
    const detacher = index.suivre(v, vaultEvents);
    try {
      v.write('Antivirus', { type: 'note' }, 'Analyse hebdomadaire des menaces.');
      assert.ok(index.candidats('antivirus menaces').some((n) => n.title === 'Antivirus'), 'une note écrite devient candidate sans tout reconstruire');
      v.rename('Antivirus', 'Sécurité');
      assert.ok(index.candidats('menaces').some((n) => n.title === 'Sécurité'), 'le renommage est suivi');
      v.trash('Sécurité');
      assert.ok(!index.candidats('menaces').some((n) => n.title === 'Sécurité'), 'la mise à la corbeille retire la note de l\'index');
    } finally { detacher(); }
  } finally { cleanup(); }
});

test('coût par demande non linéaire : une demande sélective ne rend qu\'une poignée de candidates', () => {
  const { v, cleanup } = neuf();
  try {
    for (let i = 0; i < 300; i++) v.write(`Note ${i}`, { type: 'note' }, `texte ordinaire numéro ${i} sans rien de spécial`);
    v.write('Aiguille', { type: 'note' }, 'le mot rarissime zqwxyz est ici seulement');
    const index = new IndexNotes(); index.construire(v.all());
    const cand = index.candidats('zqwxyz');
    assert.equal(cand.length, 1, 'seule la note qui contient le mot rare est candidate, pas les 300 autres');
    assert.equal(cand[0].title, 'Aiguille');
  } finally { cleanup(); }
});
