// Genèse · les écrans communs réseau + clé. On vérifie le premier chargement (Odin animé + 3 points), la barre au
// thème, la ligne serveur (« Serveur Odin IP:port ») contre la clé (« Installation clé USB »), la fenêtre de fin,
// et SURTOUT la règle de la mascotte : Odin n'a que ses deux yeux blancs en pastille (pas de bouche, de sourcils,
// de joues). Fonctions pures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES } from '../src/valhalla/thjalfi/ecran.ts';
import { barreDuTheme, fenetreFin, ligneServeur, odinSvg, premierChargement } from '../src/valhalla/thjalfi/ecrans-communs.ts';

test('Odin est toujours YEUX SEULS : deux pastilles blanches, halos, aucune bouche/sourcil/joue', () => {
  const svg = odinSvg({ anime: true });
  const pastilles = (svg.match(/<rect[^>]*rx="4\.5"[^>]*fill="#fff"/g) || []).length;
  assert.equal(pastilles, 2, 'exactement deux yeux');
  assert.ok(svg.includes('odHalo'), 'les deux halos officiels');
  for (const interdit of ['bouche', 'mouth', 'sourcil', 'brow', 'joue', 'cheek', 'smile']) assert.ok(!svg.toLowerCase().includes(interdit), `pas de ${interdit}`);
});

test('premier chargement : Odin animé + 3 points + ligne serveur ou clé', () => {
  const reseau = premierChargement({ serveur: { ip: '192.168.1.20', port: 8888 } });
  assert.ok(reseau.includes('<svg'), 'Odin dessiné');
  assert.equal((reseau.match(/class="od-points"/g) || []).length, 1);
  assert.equal((reseau.match(/<i><\/i>/g) || []).length, 3, 'trois points');
  assert.ok(reseau.includes('Serveur Odin 192.168.1.20:8888'));
  const cle = premierChargement({ serveur: 'cle' });
  assert.ok(cle.includes('Installation clé USB'));
});

test('ligne serveur : IP, port seulement si utile ; clé USB à la place', () => {
  assert.equal(ligneServeur({ ip: '10.0.0.5', port: 8888 }), 'Serveur Odin 10.0.0.5:8888');
  assert.equal(ligneServeur({ ip: '10.0.0.5', port: 80 }), 'Serveur Odin 10.0.0.5');
  assert.equal(ligneServeur({ ip: '10.0.0.5' }), 'Serveur Odin 10.0.0.5');
  assert.equal(ligneServeur('cle'), 'Installation clé USB');
});

test('barre au thème : chaque thème a sa barre ; pourcentage connu ou barre honnête', () => {
  for (const t of Object.keys(THEMES) as (keyof typeof THEMES)[]) {
    const b = barreDuTheme(t, 42);
    assert.ok(b.includes('width:42%'), `${t} : 42%`);
    assert.ok(b.includes('od-barre'), t);
  }
  const indef = barreDuTheme('bleu', null);
  assert.ok(indef.includes('od-indef'), 'sans pourcentage : barre qui avance sans mentir');
});

test('fenêtre de fin : page autonome, Odin animé + 3 points + barre, se ferme seule', () => {
  const p = fenetreFin({ theme: 'galaxie' });
  assert.ok(p.startsWith('<!doctype html>'), 'une page complète');
  assert.ok(p.includes('<svg'), 'Odin');
  assert.equal((p.match(/<i><\/i>/g) || []).length, 3, 'trois points');
  assert.match(p, /window\.close/, 'se ferme toute seule à la fin');
  assert.match(p, /id="pg"/, 'la barre des logiciels');
  // Yeux seuls ici aussi.
  for (const interdit of ['bouche', 'mouth', 'sourcil', 'brow']) assert.ok(!p.toLowerCase().includes(interdit), interdit);
});
