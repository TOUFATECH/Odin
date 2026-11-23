// Genèse · clé USB (lot A) — la CIBLE (clé OU disque dur) et le PLAN DE PLACE. On vérifie que planPlace refuse une
// cible trop petite, répartit ISO + Windows To Go + Linux installé, marque ce qui est effacé / gardé, et avertit
// pour un gros disque externe ; et que les cibles écrivables excluent le disque du système en cours (jamais
// d'effacement hors de la cible choisie). Fonctions pures : aucune liste de vrais disques, aucune écriture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPlace, ciblesEcrivables, cibleDepuisDisque, genreCible, PLACE } from '../src/valhalla/thjalfi/cle-cible.ts';
import type { Cible, SystemeCle } from '../src/valhalla/thjalfi/cle-types.ts';
import type { Disque } from '../src/valhalla/thjalfi/disques.ts';
import type { Recipe } from '../src/valhalla/thjalfi/recipes.ts';

const GO = 1024 ** 3;
const rec = (kind: Recipe['kind'], os: Recipe['os']): Recipe => ({ kind, label: `${kind}`, auto: true, os });
const cible = (p: Partial<Cible>): Cible => ({ id: 'd', genre: 'cle', tailleOctets: 64 * GO, estOdin: false, ...p });

const winInstalle: SystemeCle = { fichier: 'win11.iso', nom: 'Windows 11', famille: 'Windows', mode: 'installer', recipe: rec('windows', 'windows'), choix: 'installe', winToGo: { tailleGo: 32 } };
const linuxInstalle: SystemeCle = { fichier: 'ubuntu.iso', nom: 'Ubuntu', famille: 'Linux', mode: 'installer', recipe: rec('ubuntu', 'linux'), choix: 'installe', installPartition: { tailleGo: 20 } };
const uneIso: SystemeCle = { fichier: 'debian.iso', nom: 'Debian', famille: 'Linux', mode: 'installer', recipe: rec('debian', 'linux'), choix: 'iso' };

test('planPlace : refuse une cible trop petite et propose de réduire la liste', () => {
  const plan = planPlace(cible({ tailleOctets: 16 * GO }), [winInstalle]); // 16 Go < 32 (WinToGo) + 8 (ISO ODIN)
  assert.equal(plan.possible, false);
  assert.match(plan.blocage ?? '', /manque|réduis/i);
  assert.equal(plan.partitions.length, 0);
});

test('planPlace : répartit ISO ODIN + Windows To Go + Linux installé, marque l\'effacement', () => {
  const plan = planPlace(cible({ tailleOctets: 128 * GO }), [winInstalle, linuxInstalle, uneIso]);
  assert.equal(plan.possible, true);
  const roles = plan.partitions.map((p) => p.role);
  assert.ok(roles.includes('ISO ODIN'));
  assert.ok(roles.includes('WinToGo'));
  assert.ok(roles.includes('Linux installé'));
  const wtg = plan.partitions.find((p) => p.role === 'WinToGo')!;
  assert.equal(wtg.tailleGo, 32);
  assert.equal(wtg.efface, true); // cible non ODIN → préparée à neuf (effacée)
  const linux = plan.partitions.find((p) => p.role === 'Linux installé')!;
  assert.equal(linux.tailleGo, 20);
  // La somme tient sur la cible, et il reste de la place pour les ISO.
  assert.ok(plan.resteGo >= 0);
});

test('planPlace : cible déjà ODIN → la partition ISO ODIN est GARDÉE (pas effacée)', () => {
  const plan = planPlace(cible({ tailleOctets: 128 * GO, estOdin: true }), [linuxInstalle]);
  assert.equal(plan.possible, true);
  const iso = plan.partitions.find((p) => p.role === 'ISO ODIN')!;
  assert.equal(iso.efface, false);
});

test('planPlace : persistance posée sur la partition ISO ODIN (jamais un effacement à elle seule)', () => {
  const persist: SystemeCle = { fichier: 'mint.iso', nom: 'Mint', famille: 'Linux', mode: 'demarrer', recipe: rec('casper', 'linux'), choix: 'persistance', persistance: { label: 'casper-rw', tailleMo: 8192, fs: 'ext4' } };
  const plan = planPlace(cible({ tailleOctets: 64 * GO }), [persist]);
  const p = plan.partitions.find((x) => x.role === 'persistance')!;
  assert.equal(p.tailleGo, 8); // 8192 Mo
  assert.equal(p.efface, false);
});

test('planPlace : avertit qu\'un gros disque externe peut tout contenir', () => {
  const plan = planPlace(cible({ genre: 'disque-externe', tailleOctets: 500 * GO }), [winInstalle]);
  assert.equal(plan.possible, true);
  assert.ok(plan.avertissements.some((a) => /gros disque externe/i.test(a)));
});

test('genreCible : clé, disque externe, disque interne', () => {
  assert.equal(genreCible('cle'), 'cle');
  assert.equal(genreCible('disque-externe'), 'disque-externe');
  assert.equal(genreCible('ssd'), 'disque-externe');
  assert.equal(genreCible('carte'), 'disque-externe');
  assert.equal(genreCible('interne'), 'disque-interne');
});

// Une fausse liste de disques (aucun vrai disque touché) pour ciblesEcrivables.
function disque(p: Partial<Disque>): Disque {
  return { id: 'x', chemin: '/dev/x', tailleOctets: 32 * GO, genre: 'cle', externe: true, amovible: true, partitions: [], ...p };
}

test('ciblesEcrivables : les clés et disques externes, plus les disques ODIN ; JAMAIS le système en cours', () => {
  const liste: Disque[] = [
    disque({ id: 'cle1', genre: 'cle', externe: true }),
    disque({ id: 'ext1', genre: 'disque-externe', externe: true, tailleOctets: 500 * GO }),
    disque({ id: 'sys', genre: 'interne', externe: false, amovible: false, systemeEnCours: true, tailleOctets: 256 * GO }),
    disque({ id: 'odin-interne', genre: 'interne', externe: false, amovible: false, estOdin: true, tailleOctets: 256 * GO }),
    disque({ id: 'interne-nu', genre: 'interne', externe: false, amovible: false, tailleOctets: 256 * GO }),
  ];
  const ids = ciblesEcrivables(liste).map((c) => c.id);
  assert.ok(ids.includes('cle1'));
  assert.ok(ids.includes('ext1'));
  // Lot C4 (point 1) : même déjà ODIN, un disque interne n'est plus une cible d'écriture (même règle que l'étape
  // « Clé ») ; le double démarrage sur un disque interne garde sa propre action (cle_plan).
  assert.ok(!ids.includes('odin-interne'));
  assert.ok(!ids.includes('sys')); // le disque du système en cours : jamais touché
  assert.ok(!ids.includes('interne-nu')); // un interne quelconque : pas une cible de préparation complète
});

test('cibleDepuisDisque : reprend l\'id, la taille, estOdin', () => {
  const c = cibleDepuisDisque(disque({ id: 'cle9', tailleOctets: 16 * GO, estOdin: true }));
  assert.equal(c.id, 'cle9');
  assert.equal(c.tailleOctets, 16 * GO);
  assert.equal(c.estOdin, true);
  assert.equal(c.genre, 'cle');
  assert.ok(PLACE.winToGoGo > 0);
});
