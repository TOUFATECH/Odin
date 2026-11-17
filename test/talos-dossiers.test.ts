// Talos : dossiers du propriétaire, brouillons, corbeille (passe 1 : le modèle, le disque, les routes).
// Chaque essai tourne dans un dossier jetable : rien n'est écrit dans le vrai dossier d'Odin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize, type Workflow } from '../src/draupnir/engine.ts';
import { Talos } from '../src/draupnir/service.ts';
import { setDraupnir } from '../src/tools/draupnir.ts';
import { draupnirGet, draupnirPost } from '../src/web/draupnir-api.ts';

const jetable = () => mkdtempSync(join(tmpdir(), 'talos-dossiers-'));
const flux = (over: Partial<Workflow> = {}): Partial<Workflow> => ({ name: 'Essai', active: false, nodes: [{ name: 'Go', type: 'déclencheur.manuel', params: {} }], connections: {}, ...over });
const avecTalos = async (f: (d: Talos, home: string) => void | Promise<void>) => {
  const home = jetable(), d = new Talos(home, {});
  try { await f(d, home); } finally { d.stop(); rmSync(home, { recursive: true, force: true }); }
};
const lire = (home: string, id: string) => JSON.parse(readFileSync(join(home, 'draupnir', 'flows', `${id}.json`), 'utf8')) as Workflow;

test('1. normalize garde un dossier bien formé et rien d\'autre', () => {
  assert.equal(normalize({ ...flux(), dossier: 'd-abcd1234' }).dossier, 'd-abcd1234');
  assert.equal('dossier' in normalize({ ...flux(), dossier: '../x' }), false);
  assert.equal('dossier' in normalize(flux()), false);
});

test('2. créer un dossier : noms refusés, limite de 50, écriture atomique', () => avecTalos((d, home) => {
  const s = d.creerDossier('  Sécurité   du  réseau ');
  assert.match(s.id, /^d-[a-z0-9]{4,24}$/);
  assert.equal(s.nom, 'Sécurité du réseau', 'blancs nettoyés');
  d.creerDossier('Sécurité');
  assert.throws(() => d.creerDossier('sécurité'), /^Error: ce dossier existe déjà$/);
  assert.doesNotThrow(() => d.creerDossier('Securite'), 'les accents comptent');
  assert.throws(() => d.creerDossier('corbeille'), /^Error: nom réservé$/);
  assert.throws(() => d.creerDossier('ACTIVES'), /^Error: nom réservé$/);
  assert.throws(() => d.creerDossier(''), /^Error: nom vide$/);
  assert.throws(() => d.creerDossier('   '), /^Error: nom vide$/);
  assert.throws(() => d.creerDossier('x'.repeat(41)), /^Error: nom trop long \(40 caractères au plus\)$/);
  assert.doesNotThrow(() => d.creerDossier('é'.repeat(40)), '40 caractères passent');
  assert.throws(() => d.creerDossier('a/b'), /^Error: caractère interdit dans le nom$/);
  assert.throws(() => d.creerDossier('a<b'), /caractère interdit/);
  assert.throws(() => d.creerDossier('a​b'), /caractère interdit/);
  for (let i = d.dossiers().length; i < 50; i++) d.creerDossier(`Dossier ${i}`);
  assert.equal(d.dossiers().length, 50);
  assert.throws(() => d.creerDossier('Encore un'), /^Error: 50 dossiers au plus$/);
  const fichiers = readdirSync(join(home, 'draupnir'));
  assert.ok(fichiers.includes('dossiers.json'));
  assert.ok(!fichiers.some((f) => f.endsWith('.tmp')), 'aucun fichier temporaire ne reste');
  const disque = JSON.parse(readFileSync(join(home, 'draupnir', 'dossiers.json'), 'utf8'));
  assert.equal(disque.version, 1);
  assert.equal(disque.dossiers[0].nom, 'Sécurité du réseau', 'ordre de création');
}));

test('3. renommer : le nom change, pas l\'identifiant ni le rangement', () => avecTalos((d) => {
  const x = d.creerDossier('Maison'), w = d.save(flux({ dossier: x.id }));
  const r = d.renommerDossier(x.id, 'La maison');
  assert.deepEqual([r.id, r.nom], [x.id, 'La maison']);
  assert.equal(d.nomDossier(x.id), 'La maison');
  assert.equal(d.get(w.id)?.dossier, x.id);
  assert.doesNotThrow(() => d.renommerDossier(x.id, 'La maison'), 'son propre nom n\'est pas un doublon');
  assert.doesNotThrow(() => d.renommerDossier(x.id, 'la MAISON'), 'changer la casse de son propre nom');
  d.creerDossier('Autre');
  assert.throws(() => d.renommerDossier(x.id, 'autre'), /ce dossier existe déjà/);
  assert.throws(() => d.renommerDossier('d-inconnu1', 'Y'), /^Error: dossier introuvable$/);
}));

test('4. ranger : le champ seul, sans version ni date, par identifiant exact', () => avecTalos((d) => {
  const x = d.creerDossier('Réseau');
  const w = d.save(flux({ name: 'Mon automatisation' }));
  d.save({ ...w, name: 'Mon automatisation' }); // une version existe
  const avant = d.get(w.id)!, nVersions = d.versions(w.id).length;
  const r = d.ranger(w.id, x.id);
  assert.equal(r.dossier, x.id);
  assert.equal(d.get(w.id)?.dossier, x.id);
  assert.equal(d.versions(w.id).length, nVersions, 'aucune version');
  assert.equal(d.get(w.id)?.updatedAt, avant.updatedAt, 'updatedAt inchangé');
  assert.throws(() => d.ranger('Mon automatisation', x.id), 'jamais par le nom');
  assert.throws(() => d.ranger('Mon_automatisation', x.id), /automatisation introuvable/);
  assert.throws(() => d.ranger('../x', x.id), /^Error: identifiant invalide$/);
  assert.throws(() => d.ranger(w.id, 'd-inconnu12'), /^Error: dossier inconnu$/);
  d.ranger(w.id, '');
  assert.equal('dossier' in d.get(w.id)!, false, 'retiré du dossier');
}));

test('5. save garde le dossier sans la clé, l\'enlève avec \'\', refuse un dossier inconnu', () => avecTalos((d) => {
  const x = d.creerDossier('Organisation');
  const w = d.save(flux({ dossier: x.id }));
  assert.equal(d.setActive(w.id, true).dossier, x.id, 'setActive garde le dossier');
  const sans = { ...d.get(w.id)! } as Partial<Workflow>; delete sans.dossier;
  assert.equal(d.save(sans).dossier, x.id, 'sans la clé : gardé');
  assert.equal(d.save({ ...d.get(w.id)!, dossier: '' }).dossier, undefined, '\'\' : enlevé');
  assert.equal('dossier' in d.get(w.id)!, false);
  assert.throws(() => d.save({ ...d.get(w.id)!, dossier: 'd-inconnu12' }), /^Error: dossier inconnu$/);
  assert.throws(() => d.save(flux({ dossier: 'd-inconnu12' })), /dossier inconnu/);
}));

test('6. reprendre une version garde le dossier d\'aujourd\'hui', () => avecTalos((d) => {
  const x = d.creerDossier('A'), y = d.creerDossier('B');
  const w = d.save(flux({ name: 'V1', dossier: x.id }));
  d.save({ ...d.get(w.id)!, name: 'V2', dossier: y.id });
  const at = d.versions(w.id)[0].at;
  const r = d.restore(w.id, at);
  assert.equal(r.name, 'V1', 'l\'ancienne version revient');
  assert.equal(r.dossier, y.id, 'le dossier reste celui d\'aujourd\'hui');
  d.ranger(w.id, '');
  const at2 = d.versions(w.id).find((v) => v.name === 'V2')!.at;
  assert.equal(d.restore(w.id, at2).dossier, undefined, 'sans dossier aujourd\'hui : aucun');
  assert.throws(() => d.restore('../x', at), /identifiant invalide/);
}));

test('7. supprimer un dossier : les automatisations sont gardées, état inchangé, aucune version', () => avecTalos((d) => {
  const x = d.creerDossier('Machines');
  const a = d.save(flux({ name: 'A', active: true, dossier: x.id })), b = d.save(flux({ name: 'B', dossier: x.id })), c = d.save(flux({ name: 'C' }));
  const va = d.versions(a.id).length, vb = d.versions(b.id).length;
  assert.equal(d.supprimerDossier(x.id), 2);
  assert.equal(d.dossiers().length, 0);
  for (const [w, actif] of [[a, true], [b, false]] as const) {
    const lu = d.get(w.id)!;
    assert.equal('dossier' in lu, false);
    assert.equal(lu.active, actif, 'état gardé');
    assert.equal(lu.updatedAt, w.updatedAt);
  }
  assert.equal(d.versions(a.id).length, va); assert.equal(d.versions(b.id).length, vb);
  assert.ok(d.get(c.id));
  assert.throws(() => d.supprimerDossier(x.id), /^Error: dossier introuvable$/);
}));

test('8. corbeille : trace, liste sans les versions, restauration en brouillon, nouvel identifiant si pris', () => avecTalos((d, home) => {
  const x = d.creerDossier('Sécurité');
  const w = d.save(flux({ name: 'Jetée', active: true, dossier: x.id, nodes: [{ name: 'Appel', type: 'déclencheur.webhook', params: {} }] }));
  const chemin = String(w.nodes[0].params.chemin);
  d.trash(w.id);
  assert.equal(existsSync(join(home, 'draupnir', 'flows', `${w.id}.json`)), false);
  const posees = readdirSync(join(home, 'draupnir', 'corbeille'));
  assert.ok(!posees.some((f) => f.endsWith('.tmp')));
  const brut = JSON.parse(readFileSync(join(home, 'draupnir', 'corbeille', posees.find((f) => f.startsWith(w.id))!), 'utf8'));
  assert.equal(typeof brut.corbeille.le, 'string');
  assert.equal(brut.corbeille.dossier, x.id);
  assert.equal(brut.corbeille.etaitActive, true);
  writeFileSync(join(home, 'draupnir', 'corbeille', `v-${w.id}-1.json`), JSON.stringify({ ...w, name: 'vieille version' }));
  const l = d.listeCorbeille();
  assert.equal(l.length, 1, 'les fichiers v-… ne sont pas listés');
  assert.deepEqual([l[0].id, l[0].nom, l[0].dossier, l[0].etaitActive], [w.id, 'Jetée', x.id, true]);
  assert.ok(Math.abs(l[0].jeteeLe - Date.now()) < 60_000);
  // Restauration : brouillon, même identifiant (libre), dans son dossier.
  const r = d.restaurerCorbeille(l[0].cle);
  assert.equal(r.id, w.id); assert.equal(r.active, false, 'toujours en brouillon'); assert.equal(r.dossier, x.id);
  assert.equal('corbeille' in d.get(w.id)!, false);
  assert.equal(d.listeCorbeille().length, 0);
  // Dossier supprimé entre-temps : restaurée sans dossier.
  d.trash(w.id); d.supprimerDossier(x.id);
  const r2 = d.restaurerCorbeille(d.listeCorbeille()[0].cle);
  assert.equal(r2.dossier, undefined); assert.equal('dossier' in d.get(w.id)!, false);
  // Identifiant repris : nouvel identifiant, nouvelle adresse secrète.
  d.trash(w.id);
  d.save({ ...flux({ name: 'Remplaçante' }), id: w.id });
  const r3 = d.restaurerCorbeille(d.listeCorbeille()[0].cle);
  assert.notEqual(r3.id, w.id);
  assert.notEqual(String(r3.nodes[0].params.chemin), chemin, 'le chemin du webhook change');
  assert.match(String(r3.nodes[0].params.chemin), /^[\w-]{12,}$/);
  assert.equal(d.get(w.id)?.name, 'Remplaçante', 'celle qui avait pris l\'identifiant est intacte');
  assert.throws(() => d.restaurerCorbeille('v-x-1'), /^Error: identifiant invalide$/);
  assert.throws(() => d.restaurerCorbeille('../x'), /identifiant invalide/);
  assert.throws(() => d.restaurerCorbeille('absent-1'), /^Error: élément introuvable$/);
}));

test('9. vider la corbeille : confirmation exigée, les versions v-… restent', async () => {
  const home = jetable(), d = new Talos(home, {}); setDraupnir(d);
  try {
    const a = d.save(flux({ name: 'A' })), b = d.save(flux({ name: 'B' }));
    d.trash(a.id); d.trash(b.id);
    writeFileSync(join(home, 'draupnir', 'corbeille', 'v-a-1.json'), '{}');
    assert.deepEqual(await draupnirPost({} as never, '/api/draupnir/corbeille/vider', {}), { ok: false, error: 'confirmation manquante' });
    assert.equal(d.listeCorbeille().length, 2);
    assert.deepEqual(await draupnirPost({} as never, '/api/draupnir/corbeille/vider', { confirmer: true }), { ok: true, effacees: 2 });
    assert.deepEqual(readdirSync(join(home, 'draupnir', 'corbeille')), ['v-a-1.json']);
  } finally { setDraupnir(undefined); d.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('10. migration : un Odin d\'avant se lit sans rien réécrire, deux lectures de suite', () => {
  const home = jetable(), dir = join(home, 'draupnir');
  try {
    for (const s of ['flows', 'corbeille']) mkdirSync(join(dir, s), { recursive: true });
    const base = { nodes: [{ id: 'n1', name: 'Go', type: 'déclencheur.manuel', params: {} }], connections: {} };
    const fichiers: Record<string, string> = {
      'flows/a.json': JSON.stringify({ id: 'a', name: 'Armée', active: true, ...base }, null, 2),
      'flows/b.json': JSON.stringify({ id: 'b', name: 'Désarmée', active: false, ...base }, null, 2),
      'corbeille/c-1700000000000.json': JSON.stringify({ id: 'c', name: 'Jetée jadis', active: true, ...base }, null, 2),
    };
    for (const [f, t] of Object.entries(fichiers)) writeFileSync(join(dir, f), t);
    const verifier = () => { for (const [f, t] of Object.entries(fichiers)) assert.equal(readFileSync(join(dir, f), 'utf8'), t, `${f} identique octet pour octet`); };
    for (let k = 0; k < 2; k++) {
      const d = new Talos(home, {});
      const l = d.list();
      assert.deepEqual(l.filter((w) => w.active).map((w) => w.id), ['a']);
      assert.deepEqual(l.filter((w) => !w.active).map((w) => w.id), ['b']);
      assert.deepEqual(d.dossiers(), []);
      const c = d.listeCorbeille();
      assert.equal(c.length, 1);
      assert.deepEqual([c[0].cle, c[0].id, c[0].nom, c[0].jeteeLe, c[0].dossier], ['c-1700000000000', 'c', 'Jetée jadis', 1700000000000, undefined]);
      d.start(); d.stop();
      verifier();
    }
    assert.equal(existsSync(join(dir, 'dossiers.json')), false, 'aucune étape de migration n\'écrit');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('11. dossiers.json abîmé : mis de côté, jamais effacé, aucune exception', () => avecTalos((d, home) => {
  writeFileSync(join(home, 'draupnir', 'dossiers.json'), '{oups');
  assert.deepEqual(d.dossiers(), []);
  const mis = readdirSync(join(home, 'draupnir')).filter((f) => f.startsWith('dossiers.json.illisible-'));
  assert.equal(mis.length, 1);
  assert.equal(readFileSync(join(home, 'draupnir', mis[0]), 'utf8'), '{oups');
  // Entrées invalides ignorées à la lecture.
  writeFileSync(join(home, 'draupnir', 'dossiers.json'), JSON.stringify({ version: 1, dossiers: [{ id: '../x', nom: 'Mal' }, { id: 'd-bonbon1', nom: 'Bon', cree: '' }, { id: 'd-bonbon2', nom: 'a/b' }] }));
  assert.deepEqual(d.dossiers().map((x) => x.nom), ['Bon']);
  // Une automatisation qui cite un dossier inconnu se lit sans dossier et se laisse activer.
  const w = d.save(flux());
  writeFileSync(join(home, 'draupnir', 'flows', `${w.id}.json`), JSON.stringify({ ...lire(home, w.id), dossier: 'd-efface12' }));
  assert.equal(d.setActive(w.id, true).active, true);
}));

test('12. save refuse un identifiant dangereux', () => avecTalos((d, home) => {
  assert.throws(() => d.save({ ...flux(), id: '../x' }), /^Error: identifiant invalide$/);
  assert.throws(() => d.save({ ...flux(), id: 'a b' }), /identifiant invalide/);
  assert.equal(existsSync(join(home, 'draupnir', 'x.json')), false, 'rien n\'est écrit hors de flows/');
  assert.equal(d.save({ ...flux(), id: 'm' }).id, 'm');
  assert.equal(d.save({ ...flux({ name: 'Encore' }), id: 'm' }).name, 'Encore');
  assert.deepEqual(d.versions('../m'), []);
}));

test('13. routes : dossiers, rangement, brouillon, activation, corbeille, état', async () => {
  const home = jetable(), d = new Talos(home, {}); setDraupnir(d);
  const odin = {} as never;
  try {
    const cr = await draupnirPost(odin, '/api/draupnir/dossier/creer', { nom: 'Maison' }) as { ok: boolean; dossier: { id: string; nom: string } };
    assert.equal(cr.ok, true); assert.equal(cr.dossier.nom, 'Maison');
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/dossier/creer', { nom: 'maison' }), { ok: false, error: 'ce dossier existe déjà' });
    const w = d.save(flux({ name: 'Lampe' }));
    const rg = await draupnirPost(odin, '/api/draupnir/ranger', { id: w.id, dossier: cr.dossier.id }) as { ok: boolean; flow: Workflow };
    assert.equal(rg.ok, true); assert.equal(rg.flow.dossier, cr.dossier.id);
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/ranger', { id: 'Lampe', dossier: cr.dossier.id }), { ok: false, error: 'automatisation introuvable' });
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/ranger', { id: '../x', dossier: '' }), { ok: false, error: 'identifiant invalide' });
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/ranger', { id: w.id, dossier: 'd-inconnu12' }), { ok: false, error: 'dossier inconnu' });
    const ac = await draupnirPost(odin, '/api/draupnir/activer', { id: w.id }) as { ok: boolean; flow: Workflow };
    assert.equal(ac.flow.active, true); assert.equal(ac.flow.dossier, cr.dossier.id);
    const br = await draupnirPost(odin, '/api/draupnir/brouillon', { id: w.id }) as { ok: boolean; flow: Workflow };
    assert.equal(br.flow.active, false);
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/activer', { id: 'Lampe' }), { ok: false, error: 'automatisation introuvable' });
    const rn = await draupnirPost(odin, '/api/draupnir/dossier/renommer', { id: cr.dossier.id, nom: 'Domotique' }) as { ok: boolean; dossier: { nom: string } };
    assert.equal(rn.dossier.nom, 'Domotique');
    const st = await draupnirGet(odin, '/api/draupnir/state', new URLSearchParams(), 'https://x') as { ok: boolean; flows: Array<{ id: string; dossier?: string }>; dossiers: Array<{ id: string; nom: string; nombre: number }>; corbeille: number };
    assert.equal(st.ok, true);
    assert.deepEqual(st.dossiers, [{ id: cr.dossier.id, nom: 'Domotique', nombre: 1 }]);
    assert.equal(st.corbeille, 0);
    assert.equal(st.flows.find((f) => f.id === w.id)?.dossier, cr.dossier.id);
    const ds = await draupnirGet(odin, '/api/draupnir/dossiers', new URLSearchParams(), '') as Record<string, unknown>;
    assert.deepEqual([ds.ok, ds.actives, ds.brouillons, ds.corbeille], [true, 0, 1, 0]);
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/trash', { id: w.id }), { ok: true });
    const co = await draupnirGet(odin, '/api/draupnir/corbeille', new URLSearchParams(), '') as { ok: boolean; elements: Array<{ cle: string; id: string; nom: string; dossierNom?: string; etaitActive?: boolean }> };
    assert.equal(co.ok, true); assert.equal(co.elements.length, 1);
    assert.deepEqual([co.elements[0].id, co.elements[0].nom, co.elements[0].dossierNom, co.elements[0].etaitActive], [w.id, 'Lampe', 'Domotique', false]);
    assert.equal((await draupnirGet(odin, '/api/draupnir/state', new URLSearchParams(), '') as { corbeille: number }).corbeille, 1);
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/corbeille/restaurer', { cle: 'v-x-1' }), { ok: false, error: 'identifiant invalide' });
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/corbeille/restaurer', { cle: 'absent-1' }), { ok: false, error: 'élément introuvable' });
    const rs = await draupnirPost(odin, '/api/draupnir/corbeille/restaurer', { cle: co.elements[0].cle }) as { ok: boolean; flow: Workflow };
    assert.equal(rs.ok, true); assert.equal(rs.flow.id, w.id); assert.equal(rs.flow.active, false); assert.equal(rs.flow.dossier, cr.dossier.id);
    const sp = await draupnirPost(odin, '/api/draupnir/dossier/supprimer', { id: cr.dossier.id });
    assert.deepEqual(sp, { ok: true, liberees: 1 });
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/dossier/supprimer', { id: cr.dossier.id }), { ok: false, error: 'dossier introuvable' });
    assert.equal((await draupnirGet(odin, '/api/draupnir/state', new URLSearchParams(), '') as { flows: Array<{ dossier?: string }> }).flows[0].dossier, undefined);
  } finally { setDraupnir(undefined); d.stop(); rmSync(home, { recursive: true, force: true }); }
});
