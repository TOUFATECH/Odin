// L'onglet commun « Auto » de la page d'une appli (src/web/pages/appli-auto.js) : ajouté après les onglets de
// l'appli quand Talos a quelque chose à montrer, jamais en double ; une page sans onglets reçoit « Page » et « Auto ».
// Les fichiers de Talos dans l'interface sont lus sans document : ils ne doivent rien toucher à leur chargement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const lire = (f: string) => readFileSync(new URL(`../src/web/pages/${f}`, import.meta.url), 'utf8');
type Auto = { ONGLET: string; PAGE: string; logique: { ongletsAvecAuto: (o: string[] | undefined, m: boolean) => string[] | undefined } };
function charger(): Auto {
  const win: { OdinOngletAuto?: Auto } = {};
  vm.runInNewContext(lire('appli-auto.js'), { window: win, URLSearchParams });
  assert.ok(win.OdinOngletAuto, 'window.OdinOngletAuto est posé');
  return win.OdinOngletAuto;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

test('onglet Auto : ajouté à la fin, sans doublon, seulement quand il y a quelque chose à montrer', () => {
  const A = charger(), f = A.logique.ongletsAvecAuto;
  assert.deepEqual(ici(f(['Analyser', 'Réglages'], true)), ['Analyser', 'Réglages', 'Auto']);
  assert.deepEqual(ici(f(['Analyser', 'Auto', 'Réglages'], true)), ['Analyser', 'Réglages', 'Auto'], 'pas de doublon');
  const propres = ['Analyser', 'Réglages'];
  assert.equal(f(propres, false), propres, 'rien à montrer : les onglets de l\'appli, inchangés');
  assert.equal(f(undefined, false), undefined);
  assert.deepEqual(ici(f(undefined, true)), ['Page', 'Auto'], 'une page sans onglets (ou dessinée à la main) reçoit « Page » et « Auto »');
  assert.deepEqual(ici(f([], true)), ['Page', 'Auto']);
});

test('onglet Auto : un mot court, sans espace (il tient sur un téléphone)', () => {
  const A = charger();
  for (const o of [A.ONGLET, A.PAGE]) { assert.ok(o.length >= 3 && o.length <= 12, o); assert.ok(!/\s/.test(o), o); }
  assert.equal(A.ONGLET, 'Auto');
});

test('fichiers de Talos dans l\'interface : rien ne s\'exécute contre la page à leur chargement, chacun pose son objet', () => {
  for (const [f, nom] of [['talos-rythme.js', 'OdinRythme'], ['talos-lien.js', 'OdinLien'], ['talos-automatismes.js', 'OdinAutomatismes'], ['appli-auto.js', 'OdinOngletAuto'], ['epingles.js', 'OdinEpingles']]) {
    const win: Record<string, unknown> = {};
    // Ni document, ni fetch : un accès à l'un ou à l'autre au chargement ferait échouer cette ligne.
    vm.runInNewContext(lire(f), { window: win });
    assert.ok(win[nom], `${f} pose window.${nom}`);
    assert.ok((win[nom] as { logique?: unknown }).logique, `${f} expose sa logique pure sous .logique`);
    assert.doesNotMatch(lire(f), /OdinPages\s*\[|OdinPages\s*=|OdinPages\./, `${f} ne s'inscrit pas dans window.OdinPages (réservé aux pages d'appli)`);
  }
});
