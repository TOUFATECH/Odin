// La fiche d'une appli au survol (src/web/pages/fiche-appli.js) : son état en pastille (dans le bon ordre), ses textes
// (la phrase de survol, ou à défaut une phrase propre tirée de `what`), « Alternative à : » limité à cinq noms, et sa place
// à l'écran : jamais dehors, jamais sur l'appli survolée quand une place existe.
// Le fichier est lu sans document : il ne doit rien toucher à son chargement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

interface Etat { code: string; libelle: string; ton: string }
interface Textes { phrase: string; faire: string[]; alternatives: { noms: string[]; reste: number } }
type Rect = { x: number; y: number; w: number; h: number };
interface Logique {
  etat: (m: Record<string, unknown>) => Etat;
  textes: (m: Record<string, unknown>) => Textes;
  placer: (a: Rect, f: { w: number; h: number }, e: { w: number; h: number }, marge?: number) => { x: number; y: number; cote: string };
}
const source = readFileSync(new URL('../src/web/pages/fiche-appli.js', import.meta.url), 'utf8');
function charger(): Logique {
  const win: { OdinFicheAppli?: { logique: Logique } } = {};
  vm.runInNewContext(source, { window: win });
  assert.ok(win.OdinFicheAppli, 'window.OdinFicheAppli est posé');
  return win.OdinFicheAppli.logique;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

test('fiche : l\'état, dans l\'ordre hors ligne, alerte grave, à surveiller, mise à jour, prête', () => {
  const L = charger();
  assert.deepEqual(ici(L.etat({ horsLigne: true, grave: true, alerts: 3, updates: 2 })), { code: 'hors-ligne', libelle: 'Hors ligne', ton: 'off' });
  assert.deepEqual(ici(L.etat({ grave: true, alerts: 3, updates: 2 })), { code: 'alerte', libelle: '3 alertes', ton: 'bad' });
  assert.deepEqual(ici(L.etat({ grave: true, alerts: 1 })), { code: 'alerte', libelle: '1 alerte', ton: 'bad' });
  assert.deepEqual(ici(L.etat({ alerts: 2, updates: 2 })), { code: 'surveiller', libelle: 'À surveiller', ton: 'warn' });
  assert.deepEqual(ici(L.etat({ alerts: 0, updates: 1 })), { code: 'maj', libelle: 'Mise à jour dispo', ton: 'info' });
  assert.deepEqual(ici(L.etat({})), { code: 'pret', libelle: 'Prête', ton: 'good' });
});

test('fiche : la phrase de survol et ses actions sont reprises telles quelles', () => {
  const L = charger();
  const t = L.textes({ what: 'Tes conteneurs (sans démon)', does: ['a', 'b', 'c', 'd'], survol: { phrase: 'Lance tes applis.', faire: ['Lancer', 'Arrêter', 'Lire', 'Mettre à jour', 'Trop'] }, similaires: [] });
  assert.equal(t.phrase, 'Lance tes applis.');
  assert.deepEqual(ici(t.faire), ['Lancer', 'Arrêter', 'Lire', 'Mettre à jour'], 'quatre au plus');
  assert.deepEqual(ici(t.alternatives), { noms: [], reste: 0 });
});

test('fiche : sans phrase de survol, une phrase propre tirée de what (sans parenthèse ni comparaison, 90 caractères au plus)', () => {
  const L = charger();
  const cas = [
    'Tes bases de données comme Supabase : créer une base PostgreSQL, relier les tiennes, parcourir et modifier les tables.',
    'Tes conteneurs, sur le moteur d\'Odin (sans Docker ni Podman, sans démon) : lancer une appli depuis une image.',
    'La santé de la machine en direct et dans le temps : processeur, mémoire, disques, réseau, capteurs, SMART, RAID, carte graphique, processus. Comme Glances.',
    'Court.',
  ];
  for (const what of cas) {
    const t = L.textes({ what, does: ['lit les journaux SSH ; bannit', 'deux', 'trois', 'quatre'] });
    assert.ok(t.phrase.length <= 90, `${t.phrase} (${t.phrase.length})`);
    assert.ok(!t.phrase.includes('('), t.phrase);
    assert.doesNotMatch(t.phrase, /\bcomme\b/i);
    assert.ok(t.phrase.length > 3);
    assert.ok(t.faire.length <= 3, 'trois actions au plus en repli');
    assert.equal(t.faire[0], 'Lit les journaux SSH');
  }
});

test('fiche : « Alternative à » montre cinq noms au plus, puis le reste', () => {
  const L = charger();
  const sim = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((nom) => ({ nom, site: 'https://exemple.fr' }));
  assert.deepEqual(ici(L.textes({ what: 'x', similaires: sim }).alternatives), { noms: ['A', 'B', 'C', 'D', 'E'], reste: 2 });
  assert.deepEqual(ici(L.textes({ what: 'x', similaires: ['Un', { nom: 'Deux' }] }).alternatives), { noms: ['Un', 'Deux'], reste: 0 });
});

const recouvre = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
test('fiche : toujours dans l\'écran, jamais sur l\'appli survolée quand une place existe (390 × 800 et 1280 × 800)', () => {
  const L = charger(), m = 8;
  for (const ecran of [{ w: 390, h: 800 }, { w: 1280, h: 800 }]) {
    const fiche = { w: Math.min(340, ecran.w - 16), h: 360 };
    for (let x = 0; x <= ecran.w - 20; x += 37) {
      for (let y = 0; y <= ecran.h - 20; y += 41) {
        for (const taille of [20, 52, 90]) {
          const a = { x, y, w: Math.min(taille, ecran.w - x), h: Math.min(taille, ecran.h - y) };
          const p = L.placer(a, fiche, ecran, m), r = { x: p.x, y: p.y, w: fiche.w, h: fiche.h };
          const ou = `${ecran.w}×${ecran.h}, ancre ${JSON.stringify(a)} → ${JSON.stringify(p)}`;
          assert.ok(r.x >= m - 0.5 && r.x + r.w <= ecran.w - m + 0.5, `dans la largeur : ${ou}`);
          assert.ok(r.y >= m - 0.5 && r.y + r.h <= ecran.h - m + 0.5, `dans la hauteur : ${ou}`);
          const place = a.x + a.w + m + fiche.w <= ecran.w - m || a.x - m - fiche.w >= m || a.y + a.h + m + fiche.h <= ecran.h - m || a.y - m - fiche.h >= m;
          if (place) assert.ok(!recouvre(r, a), `ne cache pas l'appli : ${ou}`);
        }
      }
    }
  }
});

test('fiche : sur téléphone, dessous ou dessus ; sur ordinateur, à côté', () => {
  const L = charger();
  assert.match(L.placer({ x: 150, y: 100, w: 60, h: 60 }, { w: 374, h: 300 }, { w: 390, h: 800 }).cote, /^(dessous|dessus)$/);
  assert.equal(L.placer({ x: 300, y: 300, w: 60, h: 60 }, { w: 340, h: 300 }, { w: 1280, h: 800 }).cote, 'droite');
  assert.equal(L.placer({ x: 1180, y: 300, w: 60, h: 60 }, { w: 340, h: 300 }, { w: 1280, h: 800 }).cote, 'gauche');
});

test('fiche : « Alternative à », jamais « copié », « inspiré » ni « clone » ; un vrai bouton « Ouvrir » ; aucune fenêtre du navigateur', () => {
  assert.match(source, /Alternative à :/);
  const textes = [...source.matchAll(/'([^'\\]|\\.)*'|`[^`]*`/g)].map((x) => x[0]).join('\n');
  assert.doesNotMatch(textes, /copi|inspir|clone/i);
  assert.match(source, /btn primary fa-ouvrir/);
  assert.match(source, /`Ouvrir \$\{m\.name\}`/);
  assert.match(source, /z-index:45/);
  assert.match(source, /prefers-reduced-motion/);
  assert.doesNotMatch(source, /window\.(confirm|alert|prompt)\(/);
});
