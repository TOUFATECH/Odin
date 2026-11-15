// Les liens du Cerveau vivent comme des synapses (src/brain/neurones.ts) : force bornée, oubli, propagation,
// consolidation de la nuit, vitesse ; et rien au hasard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cle, consolider, forceDe, nouvelle, propager, R, renforcer, type Synapse, type Voisin } from '../src/brain/neurones.ts';

const J = 86_400_000, H = 3_600_000, T0 = Date.UTC(2026, 0, 1);
const plein = () => ({ gain: 1, reduit: 1 });
const jamais = () => false;
/** Un petit graphe : arêtes non orientées avec leur force. */
function graphe(aretes: Array<[string, string, number]>, freins: Array<[string, string]> = []): (id: string) => Voisin[] {
  const m = new Map<string, Voisin[]>();
  const pousser = (x: string, v: Voisin) => { const l = m.get(x) ?? []; l.push(v); m.set(x, l); };
  for (const [a, b, f] of aretes) { pousser(a, { id: b, f, o: 'appris' }); pousser(b, { id: a, f, o: 'appris' }); }
  for (const [a, b] of freins) pousser(a, { id: b, f: 0, o: 'frein' });
  return (id) => m.get(id) ?? [];
}

test('force bornée : 10 000 renforcements serrés ne dépassent jamais 1 ni ne donnent NaN ; une rafale compte pour un usage', () => {
  const l = nouvelle('n:a.md', 'n:b.md', 'appris', T0);
  for (let i = 0; i < 10_000; i++) { renforcer(l, 1, T0 + i * 3 * H); assert.ok(l.w <= 1 && l.w >= 0 && !Number.isNaN(l.w), `w=${l.w}`); }
  assert.ok(forceDe(l, 'appris', T0 + 30_000 * H) <= 1);
  const r = nouvelle('n:a.md', 'n:c.md', 'appris', T0);
  for (let i = 0; i < 50; i++) renforcer(r, 1, T0 + i * 1000);
  assert.equal(r.n, 1, '50 répétitions en 50 s = un seul usage');
  assert.ok(r.j < 1.05, `preuves ${r.j}`);
  assert.equal(cle('b', 'a'), cle('a', 'b'));
});

test('oubli : base jamais franchie, lien appris qui s\'éteint, demi-vie doublée par nuit (plafond 2^4)', () => {
  assert.equal(forceDe(undefined, 'ecrit', T0 + 400 * J), 0.30);
  const e = nouvelle('n:a.md', 'n:b.md', 'ecrit', T0);
  assert.equal(forceDe(e, 'ecrit', T0 + 400 * J), 0.30, 'lien écrit jamais servi');
  for (let i = 0; i < 20; i++) renforcer(e, 1, T0 + i * 2 * H, 'ecrit');
  const haut = forceDe(e, 'ecrit', T0 + 2 * J);
  assert.ok(haut > 0.4, `renforcé : ${haut}`);
  let avant = haut;
  for (const d of [30, 60, 120, 400, 2000]) { const f = forceDe(e, 'ecrit', T0 + d * J); assert.ok(f <= avant + 1e-12 && f >= 0.30, `${d} j : ${f}`); avant = f; }
  assert.equal(forceDe(e, 'ecrit', T0 + 5000 * J), 0.30);
  const a = nouvelle('n:a.md', 'n:c.md', 'appris', T0);
  renforcer(a, 1, T0); renforcer(a, 1, T0 + 3 * H);
  assert.ok(forceDe(a, 'appris', T0 + 59 * J) < R.ELAGUE, 'appris non consolidé : sous 0,05 avant 60 j');
  const k = (n: number): Synapse => ({ ...nouvelle('x', 'y', 'appris', T0), w: 0.8, k: n });
  for (const n of [0, 1, 2, 3, 4]) assert.ok(Math.abs(forceDe(k(n), 'appris', T0 + 14 * J * 2 ** n) - 0.4) < 1e-9, `k=${n}`);
  assert.ok(Math.abs(forceDe(k(6), 'appris', T0 + 14 * J * 16) - 0.4) < 1e-9, 'plafond 2^4');
});

test('propagation : moitié par saut, pas de 3e saut ni d\'écho, seuil, convergence, carrefour, frein, gain, repos, ordre stable', () => {
  // Chaîne A-B-C-D à force 1 : 1 → 0,5 → 0,25 → (pas de 3e saut).
  const chaine = graphe([['A', 'B', 1], ['B', 'C', 1], ['C', 'D', 1]]);
  const r = propager(new Map([['A', 1]]), chaine, plein, jamais);
  assert.equal(r.get('B')!.a, 0.5); assert.equal(r.get('B')!.saut, 1); assert.equal(r.get('B')!.de, 'A');
  assert.ok(Math.abs(r.get('C')!.a - 0.25 / Math.SQRT2) < 1e-12, 'B a deux voisins : son influx est partagé (√2)'); assert.equal(r.get('C')!.saut, 2);
  assert.ok(!r.has('D'), 'pas de 3e saut');
  assert.equal(r.get('A')!.a, 1, 'pas d\'écho A→B→A');
  // Sous le seuil : ni allumé, ni transmis.
  const faible = propager(new Map([['A', 0.2]]), chaine, plein, jamais);
  assert.ok(!faible.has('B'), '0,1 < 0,12 : pas allumé');
  assert.ok(!faible.has('C'));
  // Deux chemins qui convergent s'additionnent.
  const conv = propager(new Map([['A', 0.6], ['B', 0.6]]), graphe([['A', 'C', 0.5], ['B', 'C', 0.5]]), plein, jamais);
  assert.ok(Math.abs(conv.get('C')!.a - 0.3) < 1e-9, `${conv.get('C')!.a}`);
  // Carrefour de 200 liens à 0,9 : personne n'atteint le seuil d'entrée.
  const hub = graphe(Array.from({ length: 200 }, (_, i) => ['H', `v${String(i).padStart(3, '0')}`, 0.9] as [string, string, number]));
  const rh = propager(new Map([['H', 1]]), hub, plein, jamais);
  for (const [id, x] of rh) if (id !== 'H') assert.ok(x.a < R.SEUIL_AJOUT, `${id} ${x.a}`);
  // Frein « remplace » : la cible est atténuée.
  const sans = propager(new Map([['A', 1], ['N', 1]]), graphe([['A', 'V', 0.8]]), plein, jamais).get('V')!.a;
  const avec = propager(new Map([['A', 1], ['N', 1]]), graphe([['A', 'V', 0.8]], [['N', 'V']]), plein, jamais).get('V')?.a ?? 0;
  assert.ok(avec < sans, `${avec} < ${sans}`);
  // Gain nul (pas fiable, périmé) : rien ne passe.
  assert.ok(!propager(new Map([['A', 1]]), chaine, (id) => ({ gain: id === 'A' ? 0 : 1, reduit: 1 }), jamais).has('B'));
  // Repos : un point allumé par propagation qui se repose transmet moitié moins ; un point de départ, toujours pleinement.
  assert.equal(propager(new Map([['A', 1]]), chaine, plein, (id) => id === 'A').get('B')!.a, 0.5);
  assert.ok(!propager(new Map([['A', 1]]), chaine, plein, (id) => id === 'B').has('C'), 'B au repos : 0,125/√2 < 0,12, C ne s\'allume pas');
  // Même entrée, même sortie.
  const g = graphe([['A', 'B', 0.7], ['A', 'C', 0.7], ['B', 'D', 0.6], ['C', 'D', 0.6], ['A', 'E', 0.3]]);
  assert.deepEqual([...propager(new Map([['A', 1], ['B', 0.5]]), g, plein, jamais)], [...propager(new Map([['B', 0.5], ['A', 1]]), g, plein, jamais)]);
});

test('consolidation : nuit qui rend durable, effacements, plafonds par point et total, bilan exact', () => {
  const orig = () => 'appris' as const, tout = () => true;
  // Deux usages espacés puis une nuit : lien visible le lendemain.
  const l = nouvelle('n:a.md', 'n:b.md', 'appris', T0);
  renforcer(l, 1, T0); renforcer(l, 1, T0 + 2 * H);
  assert.ok(l.j >= 1.5);
  const r1 = consolider([l], T0 + 10 * H, { origine: orig, existe: tout });
  assert.equal(r1.garder[0].k, 1); assert.equal(r1.garder[0].j, 0); assert.equal(r1.bilan.renforces, 1);
  assert.ok(forceDe(r1.garder[0], 'appris', T0 + 34 * H) >= R.APPRIS_VISIBLE, `${forceDe(r1.garder[0], 'appris', T0 + 34 * H)}`);
  // Effacements : faible et ancien ; bout absent depuis plus de 30 j.
  const vieux = { ...nouvelle('n:a.md', 'n:c.md', 'appris', T0), w: 0.06 };
  const absent = { ...nouvelle('n:a.md', 'n:gone.md', 'appris', T0), w: 0.9, k: 4, vu: T0 + 50 * J };
  const r2 = consolider([vieux, absent], T0 + 40 * J, { origine: orig, existe: (id) => id !== 'n:gone.md' });
  assert.deepEqual(r2.effacer, [vieux.id]); assert.equal(r2.garder[0].absent, T0 + 40 * J);
  const r3 = consolider(r2.garder, T0 + 71 * J, { origine: orig, existe: (id) => id !== 'n:gone.md' });
  assert.deepEqual(r3.effacer, [absent.id]); assert.equal(r3.bilan.effaces, 1);
  // Un lien écrit retombé sur sa base et oublié depuis 30 j : plus besoin de le ranger.
  const e = nouvelle('n:a.md', 'n:d.md', 'ecrit', T0);
  assert.deepEqual(consolider([e], T0 + 31 * J, { origine: () => 'ecrit', existe: tout }).effacer, [e.id]);
  // Plafond par point : 12 liens, somme ≤ 3.
  const many = Array.from({ length: 20 }, (_, i) => ({ ...nouvelle('n:p.md', `n:q${String(i).padStart(2, '0')}.md`, 'appris', T0), w: 0.5 + i / 100, vu: T0 }));
  const r4 = consolider(many, T0, { origine: orig, existe: tout });
  const gardes = r4.garder.filter((x) => x.a === 'n:p.md' || x.b === 'n:p.md');
  assert.equal(gardes.length, 12); assert.equal(r4.bilan.effaces, 8);
  assert.ok(gardes.reduce((s, x) => s + x.w, 0) <= 3 + 1e-9);
  assert.equal(r4.bilan.recadres, 12);
  assert.ok(!r4.garder.some((x) => x.b === 'n:q00.md'), 'les plus faibles partent');
  // Plafond total.
  const total = Array.from({ length: R.TOTAL_APPRIS + 50 }, (_, i) => ({ ...nouvelle(`n:x${i}.md`, `n:y${i}.md`, 'appris', T0), w: 0.2 + (i % 100) / 1000, vu: T0 }));
  const r5 = consolider(total, T0, { origine: orig, existe: tout });
  assert.equal(r5.garder.length, R.TOTAL_APPRIS); assert.equal(r5.bilan.effaces, 50);
});

test('vitesse : propager sur 2 000 points et 20 000 liens, consolider 20 000 liens ; jamais de hasard', () => {
  const adj = new Map<string, Voisin[]>();
  for (let i = 0; i < 20_000; i++) {
    const a = `n:${(i * 31) % 2000}`, b = `n:${(i * 17 + 5) % 2000}`; if (a === b) continue;
    const f = 0.1 + (i % 9) / 10;
    adj.set(a, [...(adj.get(a) ?? []), { id: b, f, o: 'appris' }]); adj.set(b, [...(adj.get(b) ?? []), { id: a, f, o: 'appris' }]);
  }
  const dep = new Map(Array.from({ length: 10 }, (_, i) => [`n:${i * 97}`, 0.5 + i / 20] as [string, number]));
  propager(dep, (id) => adj.get(id) ?? [], plein, jamais);
  const t0 = performance.now(); for (let i = 0; i < 50; i++) propager(dep, (id) => adj.get(id) ?? [], plein, jamais);
  const ms = (performance.now() - t0) / 50;
  assert.ok(ms < 5, `propager : ${ms.toFixed(2)} ms`);
  const liens = Array.from({ length: 20_000 }, (_, i) => ({ ...nouvelle(`n:${(i * 31) % 2000}.md`, `n:${(i * 17 + 5) % 2001}.md`, 'appris', T0), id: `l${i}`, w: 0.1 + (i % 9) / 10, j: i % 3, vu: T0 }));
  const t1 = performance.now(); consolider(liens, T0 + J, { origine: () => 'appris', existe: () => true }); const mc = performance.now() - t1;
  assert.ok(mc < 100, `consolider : ${mc.toFixed(1)} ms`);
  for (const f of ['../src/brain/neurones.ts', '../src/brain/liens-vivants.ts', '../src/brain/rappel.ts']) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /Math\.random/, f);
});
