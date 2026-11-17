// La mémoire vive du Cerveau (src/brain/memoire-vive.ts, branchée dans src/brain/vault.ts).
// (a) même liste de notes, dans le même ordre, que le parcours complet du disque d'avant, après chaque sorte de
//     changement (Odin écrit, quelqu'un d'autre écrit, efface, crée ou renomme un dossier, corbeille, restauration) ;
//     et la recherche rend la même chose qu'un Cerveau neuf qui prend le chemin d'avant (ODIN_MEMOIRE_VIVE=non) ;
// (b) seul ce qui a changé est relu (compté) ;
// (c) un changement sur le disque est vu à la question suivante ; une note mise à la corbeille disparaît tout de suite ;
// (d) la mémoire prise est bornée par le comptable, et rendue sous pression ;
// (e) quand rien n'est gardé, les réponses restent les mêmes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Vault, parseNote } from '../src/brain/vault.ts';
import { budgetLibreMo } from '../src/brain/budget-memoire.ts';

const MOTS = 'sauvegarde serveur imprimante réseau facture électricité banque projet boutique routeur caméra jardin budget épargne crédit maison travaux disque stockage photo réunion rapport commande livraison panne réparation'.split(' ');
function coffre(n: number): string {
  const root = mkdtempSync(join(tmpdir(), 'odin-memoire-vive-'));
  let a = 11; const r = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
  for (let i = 0; i < n; i++) {
    const d = ['Projets', 'Idées', 'Journal', '', 'Projets/Anciens'][i % 5]; mkdirSync(join(root, d), { recursive: true });
    const phr = Array.from({ length: 20 + Math.floor(r() * 30) }, () => MOTS[Math.floor(r() * MOTS.length)]).join(' ');
    writeFileSync(join(root, d, `note ${i}.md`), `---\ntype: note\n---\n# Note ${i}\n\n${phr}.\n\nVoir [[note ${(i + 1) % n}]].\n`);
  }
  return root;
}
const dormir = (ms: number) => new Promise((x) => setTimeout(x, ms));
const fermer = (v: unknown, root: string) => { try { (v as { arreterVeille?: () => void }).arreterVeille?.(); } catch { /* */ } try { rmSync(root, { recursive: true, force: true, maxRetries: 5 }); } catch { /* */ } };
/** Attend que la surveillance soit posée ET ait fait ses preuves (la sonde de la mémoire vive). */
async function prouvee(v: Vault): Promise<boolean> {
  for (let i = 0; i < 80; i++) { const w = (v as unknown as { veille?: { prouvee: boolean } | null }).veille; if (w === null) return false; if (w?.prouvee) { v.all(); return true; } v.all(); await dormir(100); }
  return false;
}
/** Le parcours complet d'avant, refait ici à la main : chemins dans l'ordre du système, et contenu lu du disque. */
function reference(root: string): Array<{ path: string; body: string; mtime: number; size: number }> {
  const out: Array<{ path: string; body: string; mtime: number; size: number }> = [];
  const SKIP = new Set(['.obsidian', '.git', '.corbeille', '.trash', 'node_modules']);
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 8) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const p = join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r, depth + 1);
      else if (e.isFile() && extname(e.name) === '.md' && out.length < 20_000) { const st = statSync(p); out.push({ path: r, body: parseNote(readFileSync(p, 'utf8')).body, mtime: st.mtimeMs, size: st.size }); }
    }
  };
  walk(root, '', 0);
  return out;
}
const vue = (v: Vault) => v.all().map((n) => ({ path: n.path, body: n.body, mtime: n.mtime, size: n.size }));
/**
 * Ce que rend la recherche, dans l'ordre rendu, les ex aequo seuls rangés par chemin : l'ordre de notes au même score
 * dépend de l'histoire de l'index et du bonus de récence, déjà sur le chemin d'avant (il change d'un lancement à
 * l'autre). Ce qui est prouvé : mêmes notes, mêmes scores, même extrait, et l'ordre des scores différents.
 */
// Scores au millième : le bonus de récence dépend de l'heure de l'appel (deux appels à quelques ms d'écart donnent
// 17,000000 et 16,999999 pour une note toute neuve), sans rapport avec la mémoire vive.
const resultats = (v: Vault, q: string) => {
  const r = v.search(q, 100000).map((x) => ({ s: x.score.toFixed(3), l: `${x.score.toFixed(3)}|${x.note.path}|${x.snippet}` }));
  const out: string[] = [];
  for (let i = 0; i < r.length;) { let j = i; while (j < r.length && r[j].s === r[i].s) j++; out.push(...r.slice(i, j).map((x) => x.l).sort()); i = j; }
  return out;
};
function avecEnv<T>(env: Record<string, string | undefined>, f: () => T): T {
  const avant: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { avant[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return f(); } finally { for (const k of Object.keys(avant)) { if (avant[k] === undefined) delete process.env[k]; else process.env[k] = avant[k]; } }
}
/** Compte les lectures disque (dates, listes de dossiers, fichiers) pendant `f`. */
function compter<T>(f: () => T): { r: T; stats: number; listes: number; lectures: number } {
  const o = { stats: 0, listes: 0, lectures: 0 };
  const s0 = fs.statSync, d0 = fs.readdirSync, l0 = fs.readFileSync;
  (fs as unknown as Record<string, unknown>).statSync = (...a: unknown[]) => { o.stats++; return (s0 as (...x: unknown[]) => unknown)(...a); };
  (fs as unknown as Record<string, unknown>).readdirSync = (...a: unknown[]) => { o.listes++; return (d0 as (...x: unknown[]) => unknown)(...a); };
  (fs as unknown as Record<string, unknown>).readFileSync = (...a: unknown[]) => { o.lectures++; return (l0 as (...x: unknown[]) => unknown)(...a); };
  syncBuiltinESMExports();
  try { return { r: f(), ...o }; } finally { (fs as unknown as Record<string, unknown>).statSync = s0; (fs as unknown as Record<string, unknown>).readdirSync = d0; (fs as unknown as Record<string, unknown>).readFileSync = l0; syncBuiltinESMExports(); }
}

test('(a)(b)(c) chaque sorte de changement : même liste que le parcours complet, seul le changé est relu, vu tout de suite', async () => {
  const root = coffre(340); const v = new Vault(root);
  try {
    v.all();
    assert.ok(await prouvee(v), 'surveillance non posée ou sans preuve (disque réseau ?)');
    assert.deepEqual(vue(v), reference(root), 'départ');
    const etape = async (nom: string, faire: () => void, attente = 250) => {
      faire(); await dormir(attente);
      const c = compter(() => vue(v));
      assert.deepEqual(c.r, reference(root), `liste différente du parcours complet après : ${nom}`);
      return c;
    };
    // Juste après qu'Odin réécrit une note existante (sans laisser la préparation passer) : seule elle est relue,
    // aucune liste de dossier n'est relue.
    v.write('Projets/note 5', { type: 'note' }, '# Note 5\n\nréécrite tout de suite');
    const direct = compter(() => vue(v));
    assert.ok(direct.stats <= 3 && direct.lectures <= 2 && direct.listes === 0, `trop relu juste après une écriture : ${JSON.stringify({ ...direct, r: undefined })}`);
    assert.deepEqual(direct.r, reference(root), 'juste après une écriture');
    let c = await etape('Odin réécrit une note', () => v.write('Projets/note 0', { type: 'note' }, '# Note 0\n\nTexte changé par Odin : aquarelle.'));
    assert.ok(c.stats <= 3 && c.lectures <= 2, `trop relu après une écriture : ${JSON.stringify(c)}`);
    assert.equal(v.search('aquarelle', 5)[0]?.note.path, 'Projets/note 0.md');
    c = await etape('Odin crée une note', () => v.write('Journal/nouvelle du jour', { type: 'journal' }, '# Nouvelle\n\nsauvegarde du jour'));
    assert.ok(c.stats <= 3 && c.listes <= 2, `trop relu après une note nouvelle : ${JSON.stringify(c)}`);
    await etape('Odin crée une note dans des dossiers neufs', () => v.write('Neuf/Plus bas/encore', { type: 'note' }, '# Encore\n\nun texte rangé profond'));
    // Quelqu'un d'autre (Obsidian, un autre appareil) : la surveillance signale, la question suivante voit.
    c = await etape('une note changée à la main', () => writeFileSync(join(root, 'Idées', 'note 1.md'), '---\ntype: note\n---\n# Note 1\n\nCorrigée à la main : zorglub.\n'));
    assert.ok(c.stats <= 3, `trop relu après une correction à la main : ${JSON.stringify(c)}`);
    assert.equal(v.search('zorglub', 5)[0]?.note.path, 'Idées/note 1.md', 'la correction à la main est vue');
    await etape('une note ajoutée à la main', () => writeFileSync(join(root, 'Journal', 'a la main.md'), '# À la main\n\nbrontosaure'));
    assert.equal(v.search('brontosaure', 5).length, 1);
    await etape('une note effacée à la main', () => unlinkSync(join(root, 'Journal', 'a la main.md')));
    assert.equal(v.search('brontosaure', 5).length, 0, 'une note effacée ne ressort plus');
    await etape('un dossier entier ajouté', () => { mkdirSync(join(root, 'Import', 'Lot'), { recursive: true }); writeFileSync(join(root, 'Import', 'Lot', 'x.md'), '# X\n\ntexte importé'); writeFileSync(join(root, 'Import', 'y.md'), '# Y\n\nautre texte'); }, 400);
    await etape('un dossier renommé', () => renameSync(join(root, 'Import'), join(root, 'Importé')), 400);
    await etape('un dossier effacé', () => rmSync(join(root, 'Importé'), { recursive: true }), 400);
    // Corbeille : la note disparaît de tout ce qui est gardé, sans attendre.
    v.write('Idées/a oublier', { type: 'idée' }, '# À oublier\n\nmot secret : ptérodactyle');
    assert.equal(v.search('ptérodactyle', 5).length, 1);
    v.trash('Idées/a oublier');
    assert.equal(v.search('ptérodactyle', 5).length, 0, 'mise à la corbeille : plus rien, tout de suite');
    assert.equal(v.find('Idées/a oublier'), undefined);
    assert.deepEqual(vue(v), reference(root), 'après la corbeille');
    const f = v.trashed()[0]; v.restore(f);
    assert.equal(v.search('ptérodactyle', 5).length, 1, 'restaurée');
    assert.deepEqual(vue(v), reference(root), 'après la restauration');
    // La recherche : la même qu'un Cerveau neuf sur le chemin d'avant.
    const neuf = avecEnv({ ODIN_MEMOIRE_VIVE: 'non' }, () => new Vault(root));
    for (const q of ['sauvegarde serveur', 'facture électricité banque', 'note 12', 'jardin', 'aquarelle', 'zorglub', 'xyzzy introuvable']) {
      assert.deepEqual(resultats(v, q), avecEnv({ ODIN_MEMOIRE_VIVE: 'non' }, () => resultats(neuf, q)), `recherche « ${q} »`);
    }
    fermer(neuf, '');
  } finally { fermer(v, root); }
});

test('(a) le chemin d\'avant reste là : avec ODIN_MEMOIRE_VIVE=non, rien n\'est réservé et la liste est la même', async () => {
  const root = coffre(320);
  const v = avecEnv({ ODIN_MEMOIRE_VIVE: 'non' }, () => new Vault(root));
  try {
    avecEnv({ ODIN_MEMOIRE_VIVE: 'non' }, () => { assert.deepEqual(vue(v), reference(root)); assert.equal(v.reserveMo(), 0); });
  } finally { avecEnv({ ODIN_MEMOIRE_VIVE: 'non' }, () => fermer(v, root)); }
});

test('(d)(e) la mémoire prise est bornée par le comptable : au-delà, rien n\'est gardé, et les réponses restent justes', async () => {
  const racines = [coffre(320), coffre(320), coffre(320)];
  const vs: Vault[] = [];
  try {
    await avecEnv({ ODIN_MEMOIRE_LIBRE_MO: '100000', ODIN_MEMOIRE_MARGE_MO: '1000', ODIN_MEMOIRE_PLAFOND_MO: '2' }, async () => {
      for (const r of racines) { const v = new Vault(r); vs.push(v); v.all(); }
      const pris = vs.map((v) => v.reserveMo());
      assert.ok(pris.reduce((s, x) => s + x, 0) <= 2, `réservé au-delà du plafond : ${pris}`);
      assert.ok(pris.some((x) => x === 0), `trois coffres dans 2 Mo : l'un doit être refusé (${pris})`);
      assert.ok(pris.some((x) => x > 0), 'au moins un coffre garde ses notes');
      // Un coffre sans rien de gardé : mêmes réponses que le parcours complet et qu'un Cerveau sur le chemin d'avant.
      const i = pris.indexOf(0), v = vs[i];
      assert.deepEqual(vue(v), reference(racines[i]));
      writeFileSync(join(racines[i], 'Idées', 'tardive.md'), '# Tardive\n\nmammouth laineux');
      await dormir(300);
      assert.equal(v.search('mammouth', 5)[0]?.note.path, 'Idées/tardive.md', 'sans mémoire gardée, le changement est vu');
      const neuf = avecEnv({ ODIN_MEMOIRE_VIVE: 'non' }, () => new Vault(racines[i]));
      for (const q of ['sauvegarde serveur', 'mammouth', 'note 3']) assert.deepEqual(resultats(v, q), avecEnv({ ODIN_MEMOIRE_VIVE: 'non' }, () => resultats(neuf, q)), q);
    });
  } finally { vs.forEach((v, k) => fermer(v, racines[k])); }
});

test('(d) sous pression, le coffre vide ce qu\'il garde et rend sa part ; il reste juste ensuite', async () => {
  const root = coffre(320); const v = new Vault(root);
  try {
    await avecEnv({ ODIN_MEMOIRE_LIBRE_MO: '100000', ODIN_MEMOIRE_MARGE_MO: '1000', ODIN_MEMOIRE_PLAFOND_MO: '100000' }, async () => {
      v.all(); assert.ok(await prouvee(v));
      assert.ok(v.reserveMo() > 0, 'le coffre a sa part');
    });
    avecEnv({ ODIN_MEMOIRE_LIBRE_MO: '100', ODIN_MEMOIRE_MARGE_MO: '1000' }, () => {
      budgetLibreMo(); // le comptable voit la pression et prévient tout le monde
      assert.equal(v.reserveMo(), 0, 'part rendue sous pression');
      assert.equal((v as unknown as { cache?: unknown }).cache, undefined, 'liste des notes lâchée');
      assert.equal((v as unknown as { known: Map<string, unknown> }).known.size, 0, 'notes lues lâchées');
      // Toujours sous pression : la demande est servie (relue), mais rien n'est gardé ensuite.
      assert.deepEqual(vue(v), reference(root));
      assert.equal(v.reserveMo(), 0);
    });
    avecEnv({ ODIN_MEMOIRE_LIBRE_MO: '100000', ODIN_MEMOIRE_MARGE_MO: '1000', ODIN_MEMOIRE_PLAFOND_MO: '100000' }, () => {
      v.all(true); // la relecture suivante (au plus 3 s plus tard sans rien de gardé)
      assert.deepEqual(vue(v), reference(root));
      assert.ok(v.reserveMo() > 0, 'la pression passée, le coffre reprend sa part');
    });
  } finally { fermer(v, root); }
});

test('(c) un dossier remplacé d\'un bloc par un autre du même nom (sauvegarde rentrée) : le nouveau texte sort tout de suite', async () => {
  const base = mkdtempSync(join(tmpdir(), 'odin-memoire-vive-echange-'));
  const root = join(base, 'coffre'), dehors = join(base, 'dehors');
  mkdirSync(join(root, 'Projets'), { recursive: true }); mkdirSync(join(dehors, 'Projets'), { recursive: true });
  for (let i = 0; i < 320; i++) writeFileSync(join(root, 'Projets', `n${i}.md`), `# N${i}\n\nversion actuelle ${i}`);
  for (let i = 0; i < 320; i++) writeFileSync(join(dehors, 'Projets', `n${i}.md`), `# N${i}\n\nversion rentree depuis la sauvegarde ${i}`);
  const v = new Vault(root);
  try {
    v.all();
    assert.ok(await prouvee(v), 'surveillance non posée ou sans preuve');
    assert.equal(v.search('actuelle', 1000).length, 320);
    // L'actuel sort, la sauvegarde rentre : deux renommages de dossier, aucune écriture de fichier.
    renameSync(join(root, 'Projets'), join(base, 'ancien'));
    renameSync(join(dehors, 'Projets'), join(root, 'Projets'));
    await dormir(400);
    assert.match(v.find('Projets/n7')?.body ?? '', /rentree/, 'find rend le texte du dossier rentré');
    assert.equal(v.search('rentree', 1000).length, 320, 'la recherche voit le dossier rentré');
    assert.equal(v.search('actuelle', 1000).length, 0, 'l\'ancien texte ne sort plus');
    assert.deepEqual(vue(v), reference(root));
  } finally { fermer(v, ''); try { rmSync(base, { recursive: true, force: true, maxRetries: 5 }); } catch { /* */ } }
});

test('(d) sous pression, une recherche puis un nom cherché : rien n\'est gardé une fois la demande servie', async () => {
  const { liensDe } = await import('../src/brain/liens-vivants.ts');
  const { Mnemosyne } = await import('../src/muninn/store.ts');
  const root = coffre(320); const v = new Vault(root);
  const m = new Mnemosyne(':memory:'), l = liensDe(m);
  try {
    await avecEnv({ ODIN_MEMOIRE_LIBRE_MO: '100', ODIN_MEMOIRE_MARGE_MO: '1000' }, async () => {
      budgetLibreMo();
      assert.ok(v.search('sauvegarde serveur', 5).length > 0);
      assert.equal(v.find('Projets/note 0')?.path, 'Projets/note 0.md');
      l.voisinage(v, undefined);
      assert.equal(v.reserveMo(), 0); assert.equal(l.reserveMo(), 0);
      await dormir(20); // la demande est finie
      const w = v as unknown as { cache?: unknown; idx?: unknown; rech?: unknown; known: Map<string, unknown> };
      assert.equal(w.cache, undefined, 'liste des notes gardée sans réservation');
      assert.equal(w.idx, undefined, 'index des noms gardé sans réservation');
      assert.equal(w.rech, undefined, 'index de recherche gardé sans réservation');
      assert.equal(w.known.size, 0, 'notes lues gardées sans réservation');
      assert.equal((l as unknown as { st?: unknown }).st, undefined, 'table des voisins gardée sans réservation');
      // Et la réponse suivante reste juste.
      assert.deepEqual(vue(v), reference(root));
      assert.equal(v.search('xyzzy', 5).length, 0);
    });
  } finally { fermer(v, root); try { m.close(); } catch { /* */ } }
});

test('(c) une rafale de fichiers venue d\'ailleurs ne fait pas tout relire en tâche de fond : seulement à la demande', async () => {
  const root = coffre(600); const v = new Vault(root);
  try {
    v.all();
    assert.ok(await prouvee(v), 'surveillance non posée ou sans preuve');
    await dormir(300); v.all(); v.search('jardin', 5);
    const c = await (async () => {
      const o = { stats: 0 };
      const s0 = fs.statSync;
      (fs as unknown as Record<string, unknown>).statSync = (...a: unknown[]) => { o.stats++; return (s0 as (...x: unknown[]) => unknown)(...a); };
      syncBuiltinESMExports();
      try {
        mkdirSync(join(root, 'Import'), { recursive: true });
        for (let i = 0; i < 400; i++) writeFileSync(join(root, 'Import', `i${i}.md`), `# I${i}\n\nimporté`);
        await dormir(1500); // personne ne demande rien
        return o;
      } finally { (fs as unknown as Record<string, unknown>).statSync = s0; syncBuiltinESMExports(); }
    })();
    assert.ok(c.stats < 600, `parcours complet fait sans demande : ${c.stats} dates lues`);
    assert.deepEqual(vue(v), reference(root), 'la demande suivante voit tout');
  } finally { fermer(v, root); }
});

test('(c) la relecture complète de sécurité vient au plus tard 60 s après le dernier parcours complet', async () => {
  const root = coffre(340); const v = new Vault(root);
  try {
    v.all();
    assert.ok(await prouvee(v), 'surveillance non posée ou sans preuve');
    v.write('Journal/une ligne', { type: 'journal' }, '# Ligne\n\ntexte'); v.all(); // relecture partielle : la liste est refaite maintenant
    (v as unknown as { completA: number }).completA = Date.now() - 61_000; // le dernier parcours complet date de plus de 60 s
    const c = compter(() => v.all());
    assert.ok(c.listes >= 5, `pas de relecture complète après 60 s : ${JSON.stringify({ ...c, r: undefined })}`);
  } finally { fermer(v, root); }
});

test('(d) le miroir des dossiers est compté, pièces jointes comprises', async () => {
  const { MemoireVive } = await import('../src/brain/memoire-vive.ts');
  const m = new MemoireVive(() => {});
  m.dossiers.set('Pieces', Array.from({ length: 80_000 }, (_x, i) => ({ nom: `piece-jointe-image-numero-${i}.png`, dossier: false, fichier: true })));
  assert.ok(m.octetsMiroir() >= 80_000 * 120, `miroir sous-compté : ${m.octetsMiroir()} octets`);
  m.vider();
});

test('(d)(e) liens vivants : la table des voisins est comptée, lâchée sous pression, refaite à l\'identique', async () => {
  const { liensDe } = await import('../src/brain/liens-vivants.ts');
  const { consultBrain } = await import('../src/brain/contexte.ts');
  const { Mnemosyne } = await import('../src/muninn/store.ts');
  const root = coffre(320); const v = new Vault(root);
  const m = new Mnemosyne(':memory:'), l = liensDe(m);
  const voisins = () => { const vu = l.voisinage(v, undefined); return v.all().slice(0, 60).map((n) => JSON.stringify(vu.voisins(`n:${n.path}`, 0))); };
  const consulter = () => ['sauvegarde serveur', 'facture banque', 'jardin photo'].map((q) => JSON.stringify(consultBrain({ vault: v, liens: l, souvenirs: [] }, q, 8)));
  try {
    const avant = avecEnv({ ODIN_MEMOIRE_LIBRE_MO: '100000', ODIN_MEMOIRE_MARGE_MO: '1000', ODIN_MEMOIRE_PLAFOND_MO: '100000' }, () => ({ v: voisins(), c: consulter(), mo: l.reserveMo() }));
    assert.ok(avant.mo > 0, 'la table des voisins a sa part');
    avecEnv({ ODIN_MEMOIRE_LIBRE_MO: '100', ODIN_MEMOIRE_MARGE_MO: '1000' }, () => {
      budgetLibreMo();
      assert.equal(l.reserveMo(), 0, 'part rendue sous pression');
      assert.equal((l as unknown as { st?: unknown }).st, undefined, 'table lâchée');
      // Rien de gardé : la même chose, refaite à chaque demande.
      assert.deepEqual(voisins(), avant.v);
      assert.deepEqual(consulter(), avant.c);
      assert.equal(l.reserveMo(), 0);
    });
    avecEnv({ ODIN_MEMOIRE_LIBRE_MO: '100000', ODIN_MEMOIRE_MARGE_MO: '1000', ODIN_MEMOIRE_PLAFOND_MO: '100000' }, () => {
      assert.deepEqual(voisins(), avant.v);
      assert.ok(l.reserveMo() > 0, 'la pression passée, la table reprend sa part');
    });
  } finally { fermer(v, root); try { m.close(); } catch { /* */ } }
});
