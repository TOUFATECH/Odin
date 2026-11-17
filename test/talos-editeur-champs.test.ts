// Talos, l'éditeur à nœuds (src/web/flows.js) : les réglages d'un bloc d'appli en vrais champs.
// Logique pure (sans document) : des réglages déclarés par une fonction aux champs, et retour dans la même entrée ;
// une entrée jamais touchée reste identique ; une fonction sans réglage déclaré ; une expression ou un JSON que les
// champs ne savent pas montrer passent par « Réglages avancés » ; une valeur piégée reste du texte ; « Changer ».
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');

type P = { key: string; label: string; kind: string; required?: boolean; default?: unknown; options?: string[]; help?: string };
type F = { id: string; label: string; params?: P[]; grave?: boolean };
type A = { id: string; nom: string; actions: F[]; evenements?: string[] };
type Champ = { p: P; sorte: string; valeur: unknown; manque: boolean };
type Noeud0 = { name: string; type: string; params: Record<string, unknown>; position: [number, number] };
type Wf = { nodes: Noeud0[]; connections: Record<string, Array<Array<{ node: string }>>> };
interface Logique {
  appliDe: (liste: A[] | null, ref: unknown) => A | null;
  fonctionDe: (a: A | null, id: unknown) => F | null;
  lireEntree: (raw: unknown) => { ok: boolean; valeurs?: Record<string, unknown> };
  champsDe: (f: F, valeurs?: Record<string, unknown>) => Champ[];
  valeurChamp: (sorte: string, texte: string) => unknown;
  ecrireEntree: (raw: unknown, key: string, val: unknown) => unknown;
  manquants: (n: Noeud0, f: F) => string[];
  infoAppli: (n: Noeud0, liste: A[] | null) => { a: A; f?: F; titre: string; auto: string } | null;
  blocFonction: (a: A, f: F) => { ok: boolean; bloc?: { name: string } };
  blocSignal: (a: A, ev?: string) => { ok: boolean; bloc?: { name: string } };
  remplacer: (wf: Wf, nom: string, choix: unknown, ancienAuto?: string, liste?: A[] | null) => { ok: boolean; change?: boolean; nom?: string; error?: string };
}
function logique(): Logique {
  const win: { OdinFlows?: { logique: Logique } } = {};
  const document = { readyState: 'complete', head: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: () => ({}), addEventListener() {} };
  vm.runInNewContext(FLOWS, { window: win, document });
  return win.OdinFlows!.logique;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

// Une appli telle que la décrirait GET /api/draupnir/applis (forme du contrat, valeurs d'exemple).
const DEMARRER: F = { id: 'demarrer', label: 'Démarrer une machine', params: [
  { key: 'nom', label: 'Machine', kind: 'text', required: true, default: '', help: 'Le nom de la machine.' },
  { key: 'attendre', label: 'Attendre', kind: 'boolean', default: true },
  { key: 'coeurs', label: 'Cœurs', kind: 'number', default: 2 },
  { key: 'mode', label: 'Mode', kind: 'select', options: ['rapide', 'sûr'], default: 'sûr' },
  { key: 'note', label: 'Note', kind: 'textarea' },
  { key: 'cle', label: 'Clé', kind: 'password' },
] };
const VERIFIER: F = { id: 'verifier_isos', label: 'Vérifier toutes les ISO', params: [] };
const HYDRE: A = { id: 'ymir', nom: 'Hydre', evenements: ['alerte', 'machine_arretee'], actions: [VERIFIER, DEMARRER] };

test('des réglages déclarés aux champs : nom, aide, obligatoire, et un champ selon le type', () => {
  const L = logique();
  const c = L.champsDe(DEMARRER, { nom: 'vm1', attendre: false, coeurs: 4, mode: 'rapide' });
  assert.deepEqual(c.map((x) => [x.p.key, x.sorte, x.valeur, x.manque]), [
    ['nom', 'texte', 'vm1', false], ['attendre', 'ouinon', false, false], ['coeurs', 'nombre', 4, false],
    ['mode', 'liste', 'rapide', false], ['note', 'long', undefined, false], ['cle', 'secret', undefined, false],
  ]);
  assert.equal(c[0].p.help, 'Le nom de la machine.'); assert.equal(c[0].p.required, true);
  // Obligatoire et vide : ça se voit.
  assert.equal(L.champsDe(DEMARRER, {})[0].manque, true);
  assert.equal(L.champsDe(DEMARRER, { nom: '  ' })[0].manque, true);
  assert.deepEqual(L.manquants({ name: 'x', type: 'module.action', params: { module: 'ymir', action: 'demarrer', entrée: '{"attendre":true}' }, position: [0, 0] }, DEMARRER), ['Machine']);
  assert.deepEqual(L.manquants({ name: 'x', type: 'module.action', params: { module: 'ymir', action: 'demarrer', entrée: '{"nom":"{{ $json.vm }}"}' }, position: [0, 0] }, DEMARRER), [], 'une expression remplit le champ');
});

test('une valeur que le champ ne sait pas montrer : en texte si c\'est une expression, sinon dans « Réglages avancés »', () => {
  const L = logique();
  const c = L.champsDe(DEMARRER, { attendre: '{{ $json.ok }}', coeurs: '{{ $json.n }}', mode: '{{ $json.m }}', nom: { a: 1 }, note: 5 });
  assert.deepEqual(c.map((x) => x.sorte), ['avance', 'texte', 'nombre', 'texte', 'avance', 'secret']);
});

test('des champs à l\'entrée : même forme, même ordre, les réglages en plus gardés, un champ vidé retiré', () => {
  const L = logique();
  const raw = '{"nom":"vm1","extra":{"x":[1,2]},"attendre":true}';
  assert.equal(L.ecrireEntree(raw, 'nom', 'vm2'), '{"nom":"vm2","extra":{"x":[1,2]},"attendre":true}');
  assert.equal(L.ecrireEntree(raw, 'coeurs', 8), '{"nom":"vm1","extra":{"x":[1,2]},"attendre":true,"coeurs":8}');
  assert.equal(L.ecrireEntree(raw, 'nom', undefined), '{"extra":{"x":[1,2]},"attendre":true}');
  assert.equal(L.ecrireEntree('', 'nom', 'a'), '{"nom":"a"}');
  assert.equal(L.ecrireEntree(undefined, 'nom', 'a'), '{"nom":"a"}');
  // Une entrée rangée en objet reste un objet.
  assert.deepEqual(ici(L.ecrireEntree({ nom: 'a', z: 1 }, 'nom', 'b')), { nom: 'b', z: 1 });
  // Une entrée qui n'est pas un objet n'est jamais réécrite par un champ.
  for (const r of ['{{ $json }}', '[1,2]', '{pas du json', '"texte"', '42']) {
    assert.equal(L.lireEntree(r).ok, false, r);
    assert.equal(L.ecrireEntree(r, 'nom', 'x'), r, r);
  }
  // Une clé piégée reste une clé : ni prototype changé, ni clé perdue.
  const p = L.ecrireEntree('{"__proto__":{"pollue":1},"nom":"a"}', 'nom', 'b') as string;
  assert.equal(p, '{"__proto__":{"pollue":1},"nom":"b"}');
  assert.equal(({} as Record<string, unknown>).pollue, undefined);
});

test('du texte tapé à la valeur : nombre, oui/non, liste, expression gardée', () => {
  const L = logique();
  assert.equal(L.valeurChamp('nombre', '12'), 12); assert.equal(L.valeurChamp('nombre', '-1,5'), -1.5);
  assert.equal(L.valeurChamp('nombre', '{{ $json.n }}'), '{{ $json.n }}'); assert.equal(L.valeurChamp('nombre', ' '), undefined);
  assert.equal(L.valeurChamp('ouinon', 'oui'), true); assert.equal(L.valeurChamp('ouinon', 'non'), false); assert.equal(L.valeurChamp('ouinon', ''), undefined);
  assert.equal(L.valeurChamp('liste', 'sûr'), 'sûr'); assert.equal(L.valeurChamp('liste', ''), undefined);
  assert.equal(L.valeurChamp('texte', 'a {{ $now }}'), 'a {{ $now }}'); assert.equal(L.valeurChamp('texte', ''), undefined);
  // Une valeur piégée reste une chaîne de caractères, telle quelle.
  const piege = '<img src=x onerror="alert(1)">';
  assert.equal(L.valeurChamp('texte', piege), piege);
  assert.equal(L.ecrireEntree('{}', 'nom', piege), JSON.stringify({ nom: piege }));
});

test('aller-retour : tous les champs relus puis réécrits sans changement donnent la même entrée', () => {
  const L = logique();
  for (const raw of ['{"nom":"vm1","attendre":false,"coeurs":4,"mode":"rapide","note":"a\\nb","cle":"s","extra":1}', '{"coeurs":"{{ $json.n }}","nom":"x"}']) {
    const l = L.lireEntree(raw); assert.equal(l.ok, true);
    let r: unknown = raw;
    for (const c of L.champsDe(DEMARRER, l.valeurs)) if (c.valeur !== undefined && c.sorte !== 'avance') r = L.ecrireEntree(r, c.p.key, L.valeurChamp(c.sorte, c.sorte === 'ouinon' ? (c.valeur ? 'oui' : 'non') : String(c.valeur)));
    assert.equal(r, raw);
  }
});

test('l\'appli et la fonction d\'un bloc : par identifiant, ou par nom ; inconnue → rien (l\'ancien panneau reste)', () => {
  const L = logique(), liste = [HYDRE];
  assert.equal(L.appliDe(liste, 'ymir')?.nom, 'Hydre'); assert.equal(L.appliDe(liste, 'hydre')?.id, 'ymir');
  assert.equal(L.appliDe(liste, '{{ $json.appli }}'), null); assert.equal(L.appliDe(null, 'ymir'), null); assert.equal(L.appliDe(liste, 3), null);
  assert.equal(L.fonctionDe(HYDRE, 'demarrer')?.label, 'Démarrer une machine'); assert.equal(L.fonctionDe(HYDRE, 'inconnue'), null);
  const n = (params: Record<string, unknown>, type = 'module.action'): Noeud0 => ({ name: 'B', type, params, position: [0, 0] });
  const i = L.infoAppli(n({ module: 'ymir', action: 'demarrer', entrée: '{}' }), liste)!;
  assert.equal(i.titre, 'Démarrer une machine'); assert.equal(i.auto, 'Hydre · Démarrer une machine');
  assert.equal(L.infoAppli(n({ module: 'ymir', action: 'eteindre' }), liste), null, 'fonction inconnue');
  assert.equal(L.infoAppli(n({ module: 'ymir', événement: 'alerte', niveau: 'haute' }, 'déclencheur.module'), liste)!.titre, 'Quand elle lance une alerte');
  assert.equal(L.infoAppli(n({ module: 'ymir', événement: 'machine_arretee' }, 'déclencheur.module'), liste)!.auto, 'Quand Hydre signale « machine_arretee »');
  assert.equal(L.infoAppli(n({ secondes: 5 }, 'temps.attendre'), liste), null, 'un outil garde son dessin');
});

test('« Changer » : une autre fonction remplace celle du bloc ; liens, place et réglages des autres gardés', () => {
  const L = logique();
  const wf: Wf = { nodes: [
    { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [0, 0] },
    { name: 'Hydre · Démarrer une machine', type: 'module.action', params: { module: 'ymir', action: 'demarrer', entrée: '{"nom":"vm1"}' }, position: [280, 0] },
  ], connections: { Lancer: [[{ node: 'Hydre · Démarrer une machine' }]] } };
  // La même fonction : rien ne change.
  const m = L.remplacer(wf, 'Hydre · Démarrer une machine', L.blocFonction(HYDRE, DEMARRER), 'Hydre · Démarrer une machine');
  assert.deepEqual({ ok: m.ok, change: m.change }, { ok: true, change: false }); assert.equal(wf.nodes[1].params.entrée, '{"nom":"vm1"}');
  const r = L.remplacer(wf, 'Hydre · Démarrer une machine', L.blocFonction(HYDRE, VERIFIER), 'Hydre · Démarrer une machine');
  assert.equal(r.ok, true); assert.equal(r.change, true); assert.equal(r.nom, 'Hydre · Vérifier toutes les ISO', 'le nom donné par Odin suit la fonction');
  assert.deepEqual(ici(wf.nodes[1].params), { module: 'ymir', action: 'verifier_isos', entrée: '{}' });
  assert.deepEqual(ici(wf.nodes[1].position), [280, 0]);
  // Un nom choisi à la main est gardé.
  wf.nodes[1].name = 'Mon bloc';
  assert.equal(L.remplacer(wf, 'Mon bloc', L.blocFonction(HYDRE, DEMARRER), 'Hydre · Vérifier toutes les ISO').nom, undefined);
  // Grave, autre sorte de bloc, bloc disparu : refusé, rien ne change.
  const avant = JSON.stringify(wf);
  assert.equal(L.remplacer(wf, 'Mon bloc', L.blocFonction(HYDRE, { id: 'x', label: 'X', grave: true })).ok, false);
  assert.equal(L.remplacer(wf, 'Mon bloc', L.blocSignal(HYDRE, 'alerte')).ok, false);
  assert.equal(L.remplacer(wf, 'Disparu', L.blocFonction(HYDRE, VERIFIER)).ok, false);
  assert.equal(JSON.stringify(wf), avant);
  // Un déclencheur d'appli : l'événement change, le niveau réglé est gardé.
  const w2: Wf = { nodes: [{ name: 'Quand Hydre lance une alerte', type: 'déclencheur.module', params: { module: 'ymir', événement: 'alerte', niveau: 'critique' }, position: [0, 0] }], connections: {} };
  const r2 = L.remplacer(w2, 'Quand Hydre lance une alerte', L.blocSignal(HYDRE, 'machine_arretee'), 'Quand Hydre lance une alerte');
  assert.equal(r2.ok, true); assert.deepEqual(ici(w2.nodes[0].params), { module: 'ymir', événement: 'machine_arretee', niveau: 'critique' });
});

test('« Changer » vers la même fonction d\'un bloc qui nomme son appli par son nom : rien ne change, ses réglages restent', () => {
  const L = logique();
  const wf: Wf = { nodes: [
    { name: 'Mes ISO', type: 'module.action', params: { module: 'Hydre', action: 'verifier_isos', entrée: { z: 1 } }, position: [0, 0] },
    { name: 'Q', type: 'déclencheur.module', params: { module: 'hydre', événement: 'alerte', niveau: 'critique' }, position: [0, 0] },
  ], connections: {} };
  const avant = JSON.stringify(wf);
  const r = L.remplacer(wf, 'Mes ISO', L.blocFonction(HYDRE, VERIFIER), 'Hydre · Vérifier toutes les ISO', [HYDRE]);
  assert.deepEqual({ ok: r.ok, change: r.change }, { ok: true, change: false });
  const r2 = L.remplacer(wf, 'Q', L.blocSignal(HYDRE, 'alerte'), 'Quand Hydre lance une alerte', [HYDRE]);
  assert.deepEqual({ ok: r2.ok, change: r2.change }, { ok: true, change: false });
  assert.equal(JSON.stringify(wf), avant, 'ni l\'appli, ni l\'entrée, ni le niveau ne bougent');
  // Une autre fonction de la même appli, elle, remplace bien.
  assert.equal(L.remplacer(wf, 'Mes ISO', L.blocFonction(HYDRE, DEMARRER), '', [HYDRE]).change, true);
});

test('un grand entier que les champs perdraient : l\'entrée passe par « Réglages avancés », jamais réécrite', () => {
  const L = logique();
  for (const raw of ['{"n":12345678901234567890}', '{"a":{"b":[1,-90071992547409931]}}']) {
    assert.equal(L.lireEntree(raw).ok, false, raw);
    assert.equal(L.ecrireEntree(raw, 'nom', 'x'), raw, raw);
  }
  assert.equal(L.lireEntree('{"n":9007199254740991,"x":1.5}').ok, true, 'un entier sûr se lit');
});
