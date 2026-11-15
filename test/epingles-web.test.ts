// Épingles du menu (src/web/pages/epingles.js) : épingler à la fin, retirer, 12 applis au plus (les vues d'Odin ne
// comptent pas), monter et descendre sans sortir de la liste, et une liste nettoyée de ce qui n'existe pas.
// Le fichier est lu sans document : il ne doit rien toucher à son chargement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

interface Logique {
  MAX: number; VUES: string[];
  basculer: (l: string[], id: string, max?: number) => { liste: string[]; code?: string };
  deplacer: (l: string[], id: string, sens: number) => string[];
  nettoyer: (l: unknown, connus?: string[]) => string[];
}
function charger(): Logique {
  const win: { OdinEpingles?: { logique: Logique; bouton: unknown; estEpingle: (id: string) => boolean } } = {};
  vm.runInNewContext(readFileSync(new URL('../src/web/pages/epingles.js', import.meta.url), 'utf8'), { window: win });
  assert.ok(win.OdinEpingles, 'window.OdinEpingles est posé');
  assert.equal(win.OdinEpingles.estEpingle('appli:ymir'), false, 'rien d\'épinglé tant qu\'Odin n\'a pas répondu');
  return win.OdinEpingles.logique;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

test('épingles : épingler va à la fin, une seconde fois retire', () => {
  const L = charger();
  const a = L.basculer(['vue:flows'], 'appli:ymir'); assert.deepEqual(ici(a.liste), ['vue:flows', 'appli:ymir']); assert.equal(a.code, undefined);
  const b = L.basculer(a.liste, 'appli:sindri'); assert.deepEqual(ici(b.liste), ['vue:flows', 'appli:ymir', 'appli:sindri']);
  assert.deepEqual(ici(L.basculer(b.liste, 'appli:ymir').liste), ['vue:flows', 'appli:sindri']);
  assert.deepEqual(ici(L.basculer(b.liste, 'vue:flows').liste), ['appli:ymir', 'appli:sindri'], 'une vue se retire comme une appli');
});

test('épingles : 12 applis au plus, les 6 vues ne comptent pas', () => {
  const L = charger();
  assert.equal(L.MAX, 12);
  assert.deepEqual(ici(L.VUES), ['vue:flows', 'vue:runes', 'vue:missions', 'vue:skills', 'vue:jobs', 'vue:audit']);
  let l = [...L.VUES];
  for (let i = 0; i < 12; i++) { const r = L.basculer(l, `appli:a${i}`); assert.equal(r.code, undefined, `appli ${i + 1}`); l = r.liste; }
  assert.equal(l.length, 18);
  const trop = L.basculer(l, 'appli:treize'); assert.equal(trop.code, 'max'); assert.deepEqual(ici(trop.liste), ici(l), 'la liste ne change pas');
  // Une vue retirée se remet même avec 12 applis.
  const sansVue = L.basculer(l, 'vue:jobs').liste; assert.equal(L.basculer(sansVue, 'vue:jobs').code, undefined);
});

test('épingles : monter et descendre, sans sortir aux bords', () => {
  const L = charger();
  const l = ['vue:flows', 'appli:ymir', 'appli:sindri'];
  assert.deepEqual(ici(L.deplacer(l, 'appli:ymir', -1)), ['appli:ymir', 'vue:flows', 'appli:sindri']);
  assert.deepEqual(ici(L.deplacer(l, 'appli:ymir', 1)), ['vue:flows', 'appli:sindri', 'appli:ymir']);
  assert.deepEqual(ici(L.deplacer(l, 'vue:flows', -1)), l, 'le premier ne monte pas plus haut');
  assert.deepEqual(ici(L.deplacer(l, 'appli:sindri', 1)), l, 'le dernier ne descend pas plus bas');
  assert.deepEqual(ici(L.deplacer(l, 'appli:inconnue', 1)), l);
  assert.deepEqual(l, ['vue:flows', 'appli:ymir', 'appli:sindri'], 'la liste d\'origine n\'est pas modifiée');
});

test('épingles : la liste est nettoyée des inconnus et des doublons', () => {
  const L = charger();
  assert.deepEqual(ici(L.nettoyer(['vue:flows', 'appli:ymir', 'appli:ymir', 'vue:inconnue', 'appli:Pas Bon', 'n_importe', 42, 'vue:flows', 'appli:sindri'])), ['vue:flows', 'appli:ymir', 'appli:sindri']);
  assert.deepEqual(ici(L.nettoyer(['appli:ymir', 'appli:disparue', 'vue:jobs'], ['ymir', 'sindri'])), ['appli:ymir', 'vue:jobs'], 'une appli qui n\'existe plus est retirée ; les vues restent');
  assert.deepEqual(ici(L.nettoyer(undefined)), []);
});
