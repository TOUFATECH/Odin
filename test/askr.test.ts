// Atlas, l'inventaire : fiches, appareils du réseau ajoutés sans écraser ce que tu as écrit, prêts, garanties,
// étiquettes QR, licences, export / import CSV (Excel, sans formules piégées), graphe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { assetGraph, due, fromCsv, guessKind, merge, toCsv, type Asset } from '../src/valhalla/modules/askr.ts';

test('appareils du réseau : une fiche par MAC, adresse tenue à jour, ce que tu as écrit jamais écrasé', () => {
  const t = Date.now();
  const r1 = merge([], [{ ip: '192.168.1.20', mac: 'B8:27:EB:00:00:01', name: 'nas' }, { ip: '192.168.1.30', model: 'Galaxy Tab S9' }], t, (m) => (m.startsWith('b8:27:eb') ? 'Raspberry Pi' : ''));
  assert.deepEqual(r1.added.map((a) => [a.tag, a.name, a.kind, a.maker, a.mac]), [['ODN-0001', 'nas', 'serveur', 'Raspberry Pi', 'b8:27:eb:00:00:01'], ['ODN-0002', 'Galaxy Tab S9', 'tablette', undefined, undefined]]);
  const mine = r1.list.map((a) => (a.tag === 'ODN-0001' ? { ...a, name: 'NAS du salon', location: 'Salon' } : a));
  const r2 = merge(mine, [{ ip: '192.168.1.21', mac: 'b8:27:eb:00:00:01', name: 'autre-nom' }], t + 1000);
  assert.equal(r2.added.length, 0); assert.equal(r2.updated, 1);
  const nas = r2.list.find((a) => a.tag === 'ODN-0001')!;
  assert.deepEqual([nas.name, nas.location, nas.ip], ['NAS du salon', 'Salon', '192.168.1.21'], 'nom et pièce gardés, adresse à jour');
  assert.match(nas.history.at(-1)!.what, /nouvelle adresse 192\.168\.1\.21 \(avant 192\.168\.1\.20\)/);
  assert.equal(guessKind({ name: 'HP LaserJet' }), 'imprimante'); assert.equal(guessKind({ maker: 'Espressif' }), 'objet connecté'); assert.equal(guessKind({ name: 'iPhone de Awa' }), 'téléphone'); assert.equal(guessKind({ name: 'Livebox' }), 'réseau');
});

test('garanties, prêts en retard ; CSV pour Excel sans formules piégées ; graphe', () => {
  const a = (x: Partial<Asset>): Asset => ({ id: x.tag!, name: x.tag!, kind: 'ordinateur', state: 'en service', source: 'toi', firstSeen: 0, history: [], ...x } as Asset);
  const list = [a({ tag: 'ODN-0001', warrantyEnd: '2026-11-20', location: 'Bureau' }), a({ tag: 'ODN-0002', warrantyEnd: '2027-06-01' }), a({ tag: 'ODN-0003', state: 'prêté', loan: { to: 'Ali', since: '2026-11-01', due: '2026-11-10' }, owner: 'Awa' }), a({ tag: 'ODN-0004', warrantyEnd: '2026-11-01', state: 'retiré' })];
  const d = due(list, '2026-11-12');
  assert.deepEqual(d.warranty.map((x) => [x.a.tag, x.left]), [['ODN-0001', 8]]); assert.deepEqual(d.late.map((x) => [x.a.tag, x.late]), [['ODN-0003', 2]]);
  const csv = toCsv([a({ tag: 'ODN-0009', name: '=HYPERLINK("http://pirate")', notes: 'a;b', price: 1299.5 })]);
  assert.match(csv, /^etiquette;nom;type/); assert.match(csv, /"'=HYPERLINK\(""http:\/\/pirate""\)"/, 'formule neutralisée'); assert.match(csv, /"a;b"/);
  const back = fromCsv(csv); assert.equal(back[0].name, '=HYPERLINK("http://pirate")'); assert.equal(back[0].price, 1299.5);
  assert.deepEqual(fromCsv('Nom,Type,MAC,Prix\nImprimante bureau,imprimante,AA:BB:CC:DD:EE:01,"249,90"').map((x) => [x.name, x.kind, x.mac, x.price]), [['Imprimante bureau', 'imprimante', 'AA:BB:CC:DD:EE:01', 249.9]]);
  assert.throws(() => fromCsv('type;mac\nx;y'), /colonne « nom »/);
  const g = assetGraph(list, '2026-11-12', (x) => x.tag === 'ODN-0002');
  const n = (id: string) => g.nodes.find((x) => x.id === id);
  assert.ok(n('l:Bureau')?.square && n('l:Sans pièce') && n('o:Ali') && n('o:Awa') === undefined ? true : n('o:Ali') !== undefined);
  assert.equal(n('a:ODN-0003')?.ring, '#EE6A55', 'prêt en retard'); assert.equal(n('a:ODN-0001')?.ring, '#F0A040', 'garantie bientôt finie'); assert.equal(n('a:ODN-0002')?.ring, '#57C98A', 'en ligne'); assert.equal(n('a:ODN-0004')?.off, true);
  assert.ok(g.edges.some((e) => e.a === 'a:ODN-0003' && e.b === 'o:Ali' && e.dash), 'prêt : lien en pointillé vers la personne');
});

test('appli Atlas : ajouter, doublons refusés, modifier, prêter / rendre, étiquette, licences, export / import, supprimer (grave)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'askr-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  const act = (x: string, i: Record<string, unknown> = {}) => v.act('askr', x, i);
  try {
    assert.match((await act('ajouter', { nom: 'PC bureau', type: 'ordinateur', mac: 'B8-27-EB-00-00-01', serie: 'SN-1', prix: '1 299,50 €', garantie: '2028-01-31', piece: 'Bureau' })).text, /PC bureau ajouté \(ODN-0001, ordinateur, garantie jusqu'au 2028-01-31\)/);
    assert.match((await act('ajouter', { nom: 'Autre', mac: 'b8:27:eb:00:00:01' })).text, /déjà dans l'inventaire \(ODN-0001\)/);
    assert.equal((await act('ajouter', { nom: 'X', garantie: '31/01/2028' })).ok, false);
    assert.equal((await act('ajouter', { nom: 'X', type: 'fusée' })).ok, false);
    const a = (v.ctx('askr').settings.assets as Asset[])[0];
    assert.deepEqual([a.mac, a.price, a.maker], ['b8:27:eb:00:00:01', 1299.5, 'Raspberry Pi']);
    assert.match((await act('modifier', { appareil: 'ODN-0001', proprietaire: 'Awa', etat: 'en réparation' })).text, /owner, état mis à jour/);
    assert.equal((await act('modifier', { appareil: 'ODN-0001' })).ok, false, 'rien à changer');
    assert.equal((await act('preter', { appareil: 'PC bureau', a: 'Ali', retour: '2020-01-01' })).ok, false, 'retour dans le passé refusé');
    assert.match((await act('preter', { appareil: 'PC bureau', a: 'Ali' })).text, /prêté à Ali/);
    assert.equal((await act('preter', { appareil: 'PC bureau', a: 'Sara' })).ok, false, 'déjà prêté');
    assert.match((await act('rendre', { appareil: 'pc bureau' })).text, /rendu par Ali/);
    const e = await act('etiquette', { appareil: 'ODN-0001' });
    assert.match((e.data as { svg: string }).svg, /^<svg/); assert.match((e.data as { conf: string }).conf, /^ODN-0001\nPC bureau[\s\S]*S\/N SN-1/);
    assert.match((await act('licence', { nom: 'Antivirus', postes: 1, expire: '2027-01-01' })).text, /Antivirus : 1 poste\(s\), jusqu'au 2027-01-01/);
    assert.match((await act('attribuer', { licence: 'antivirus', appareil: 'ODN-0001' })).text, /1\/1 postes/);
    await act('ajouter', { nom: 'Portable', type: 'portable' });
    assert.match((await act('attribuer', { licence: 'Antivirus', appareil: 'Portable' })).text, /plus de poste libre/);
    const csv = (await act('exporter')).data as { conf: string; filename: string };
    assert.match(csv.filename, /^inventaire-\d{4}-\d{2}-\d{2}\.csv$/); assert.match(csv.conf, /ODN-0001;PC bureau;ordinateur/);
    assert.match((await act('importer', { csv: 'nom;mac;serie\nImprimante;AA:BB:CC:DD:EE:01;\nDoublon;b8:27:eb:00:00:01;' })).text, /1 appareil\(s\) importé\(s\) ; 1 déjà présent\(s\)[\s\S]*Doublon/);
    assert.match((await act('chercher', { q: 'imprim' })).text, /ODN-0003 · Imprimante \(imprimante\)/);
    assert.match((await act('retirer', { appareil: 'Portable', pourquoi: 'cassé' })).text, /retiré du service/);
    const del = await v.act('askr', 'supprimer', { appareil: 'Portable' }, { auto: true });
    assert.equal(del.ok, false, 'une automatisation ne supprime pas une fiche');
    const view = await v.module('askr')!.view(v.ctx('askr'), new URLSearchParams());
    assert.ok(view.sections.some((s) => s.kind === 'graph')); assert.equal(view.kpis!.find((k) => k.label === 'Valeur d\'achat')!.value.replace(/\s/g, ' '), '1 299,5 €');
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});
