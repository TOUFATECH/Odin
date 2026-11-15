// Talos, « Faire un lien » (src/web/pages/talos-lien.js) : le formulaire envoie exactement le corps attendu par
// POST /api/draupnir/lien (contrat entre l'interface et le serveur), refuse une action grave et une 9e appli à la suite.
// Le fichier est lu sans document : il ne doit rien toucher à son chargement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type Etat = { quand: Record<string, unknown>; etapes: Array<{ appli: string; action: string; entree?: Record<string, unknown> }>; nom?: string; activer?: boolean };
interface Logique {
  MAX_ETAPES: number;
  versRequete: (e: Etat) => unknown;
  etapeValide: (e: Etat['etapes'][number], appli: unknown) => string;
  valideTout: (e: Etat, applis: unknown[]) => { ok: boolean; error?: string; etape?: number };
  ajouter: (e: Etat, appli?: string) => boolean;
}
function charger(): Logique {
  const win: { OdinLien?: { logique: Logique } } = {};
  vm.runInNewContext(readFileSync(new URL('../src/web/pages/talos-lien.js', import.meta.url), 'utf8'), { window: win });
  assert.ok(win.OdinLien, 'window.OdinLien est posé');
  return win.OdinLien.logique;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

// Hydre telle que la décrirait GET /api/draupnir/applis (forme du contrat, valeurs d'exemple).
const HYDRE = { id: 'ymir', nom: 'Hydre', famille: 'Machines', evenements: ['alerte'], actions: [
  { id: 'verifier_isos', label: 'Vérifier toutes les ISO', what: 'Compare chaque ISO à sa source.', params: [], read: false, grave: false },
  { id: 'demarrer', label: 'Démarrer une machine', what: 'Démarre une machine virtuelle.', params: [{ key: 'nom', label: 'Machine', kind: 'text', required: true }], read: false, grave: false },
  { id: 'supprimer', label: 'Supprimer une machine', what: '', params: [{ key: 'nom', label: 'Machine', kind: 'text', required: true }], read: false, grave: true, raison: 'Action grave : elle demande ton accord et ne part pas d\'une automatisation.' },
] };

test('lien : le corps de la demande, pour les trois sortes de « quand »', () => {
  const L = charger();
  const etapes = [{ appli: 'ymir', action: 'verifier_isos', entree: {} }, { appli: 'ymir', action: 'demarrer', entree: { nom: 'web', vide: '', rien: undefined } }];
  assert.deepEqual(ici(L.versRequete({ quand: { sorte: 'main', rythme: null, appli: 'x' }, etapes, nom: '  ', activer: false })), {
    quand: { sorte: 'main' }, etapes: [{ appli: 'ymir', action: 'verifier_isos' }, { appli: 'ymir', action: 'demarrer', entree: { nom: 'web' } }], activer: false,
  });
  assert.deepEqual(ici(L.versRequete({ quand: { sorte: 'rythme', rythme: { genre: 'mois', jour: 1, heure: '04:00' }, appli: '' }, etapes: etapes.slice(0, 1), nom: ' ISO du mois ', activer: true })), {
    quand: { sorte: 'rythme', rythme: { genre: 'mois', jour: 1, heure: '04:00' } }, etapes: [{ appli: 'ymir', action: 'verifier_isos' }], activer: true, nom: 'ISO du mois',
  });
  assert.deepEqual(ici(L.versRequete({ quand: { sorte: 'appli', appli: 'ymir', evenement: 'alerte', niveau: 'haute' }, etapes: etapes.slice(0, 1) })), {
    quand: { sorte: 'appli', appli: 'ymir', evenement: 'alerte', niveau: 'haute' }, etapes: [{ appli: 'ymir', action: 'verifier_isos' }], activer: false,
  });
  // Tout ce qu'elle signale (événement vide), sans niveau choisi.
  assert.deepEqual(ici(L.versRequete({ quand: { sorte: 'appli', appli: 'ymir', evenement: '', niveau: '' }, etapes: etapes.slice(0, 1) })), {
    quand: { sorte: 'appli', appli: 'ymir', evenement: '' }, etapes: [{ appli: 'ymir', action: 'verifier_isos' }], activer: false,
  });
  // Une expression qui reprend l'étape d'avant part telle quelle.
  assert.deepEqual(ici((L.versRequete({ quand: { sorte: 'main' }, etapes: [{ appli: 'ymir', action: 'demarrer', entree: { nom: '{{ $json.nom }}' } }] }) as { etapes: unknown[] }).etapes), [{ appli: 'ymir', action: 'demarrer', entree: { nom: '{{ $json.nom }}' } }]);
});

test('lien : une action grave, une fonction sans son réglage obligatoire, une appli inconnue sont signalées', () => {
  const L = charger();
  assert.equal(L.etapeValide({ appli: 'ymir', action: 'verifier_isos', entree: {} }, HYDRE), '');
  assert.match(L.etapeValide({ appli: 'ymir', action: 'supprimer', entree: { nom: 'web' } }, HYDRE), /grave/i);
  assert.match(L.etapeValide({ appli: 'ymir', action: 'demarrer', entree: {} }, HYDRE), /Machine.*obligatoire/);
  assert.equal(L.etapeValide({ appli: 'ymir', action: 'demarrer', entree: { nom: '{{ $json.nom }}' } }, HYDRE), '');
  assert.notEqual(L.etapeValide({ appli: '', action: '' }, undefined), '');
  assert.notEqual(L.etapeValide({ appli: 'ymir', action: '' }, HYDRE), '');
  assert.notEqual(L.etapeValide({ appli: 'ymir', action: 'inconnue' }, HYDRE), '');
  const v = L.valideTout({ quand: { sorte: 'main' }, etapes: [{ appli: 'ymir', action: 'verifier_isos' }, { appli: 'ymir', action: 'supprimer', entree: { nom: 'x' } }] }, [HYDRE]);
  assert.equal(v.ok, false); assert.equal(v.etape, 1, 'l\'erreur est montrée sous la 2e étape');
  assert.equal(L.valideTout({ quand: { sorte: 'rythme', rythme: null }, etapes: [{ appli: 'ymir', action: 'verifier_isos' }] }, [HYDRE]).ok, false, 'un rythme est demandé');
  assert.equal(L.valideTout({ quand: { sorte: 'main' }, etapes: [] }, [HYDRE]).ok, false, 'au moins une appli');
  assert.equal(L.valideTout({ quand: { sorte: 'main' }, etapes: [{ appli: 'ymir', action: 'verifier_isos' }] }, [HYDRE]).ok, true);
});

test('lien : 8 applis au plus à la suite, la 9e est refusée', () => {
  const L = charger();
  assert.equal(L.MAX_ETAPES, 8);
  const e: Etat = { quand: { sorte: 'main' }, etapes: [] };
  for (let i = 0; i < 8; i++) assert.equal(L.ajouter(e, 'ymir'), true, `étape ${i + 1}`);
  assert.equal(L.ajouter(e, 'ymir'), false, 'la 9e n\'est pas ajoutée'); assert.equal(e.etapes.length, 8);
  const neuf: Etat = { quand: { sorte: 'main' }, etapes: Array.from({ length: 9 }, () => ({ appli: 'ymir', action: 'verifier_isos' })) };
  const v = L.valideTout(neuf, [HYDRE]); assert.equal(v.ok, false); assert.match(v.error ?? '', /8/);
});
