// Pégase dans la base d'Odin, avec un VRAI serveur PostgreSQL jetable, arrêté et relancé pour de vrai : migration
// fichiers → base (données identiques avant/après, copie de secours), Odin relancé (lecture depuis la base), base
// arrêtée puis revenue, Odin relancé pendant que la base est arrêtée, retour en fichiers ; Odin lit la base pour
// répondre (Alexandrie, SQL en lecture) : les vues oui, les tables et les écritures non.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pgDisponible, pgJetable } from './banc/pg-jetable.ts';
import { BaseAttente, BaseOdin, lesMigrables, utiliserBase } from '../src/valhalla/base/index.ts';
import { Magasin, type Rec } from '../src/valhalla/pegase/store.ts';
import { brancherPegase, etatPegase, SupportBase } from '../src/valhalla/pegase/base.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { urdr } from '../src/valhalla/modules/urdr.ts';
import { isSecretFile } from '../src/heimdall/policy.ts';

const SANS_PG = !pgDisponible() && 'PostgreSQL (initdb, pg_ctl) absent de la machine';
const attendre = async (f: () => boolean | Promise<boolean>, ms = 20_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('délai dépassé'); };
const silence = () => undefined;

/** Un magasin Pégase rempli en fichiers : 2 profils, favoris, onglets, historique sur 2 jours (avec une pierre tombale), copies. */
function remplir(m: Magasin, now: number): void {
  m.setPrefs('p1', { voir: 'tout', agendaCle: 'cle-agenda' }); m.setPrefs('p2', { voir: 'rien' });
  m.nouvelAppareil('p1', { nom: 'PC du salon', plateforme: 'windows', ip: '192.168.1.20' });
  m.nouvelAppareil('p2', { nom: 'Téléphone', plateforme: 'android' });
  const hier = now - 86400_000;
  m.appliquer('p1', 'a_1', [
    { id: 'f1', col: 'favoris', data: { url: 'https://mayotte.fr', titre: 'Mayotte', dossier: { nom: 'îles', ordre: 2 } }, maj: hier },
    { id: 'f2', col: 'favoris', data: { url: 'https://toufatech.yt' }, maj: hier },
    { id: 'o1', col: 'onglets', data: { url: 'https://a.yt', epingle: true }, maj: hier },
    { id: 'r1', col: 'agenda', data: { titre: 'Dentiste', debut: '2026-11-20T09:00:00Z', lieu: 'Mamoudzou' }, maj: hier },
    { id: 'h1', col: 'historique', data: { url: 'https://www.google.com/search?q=starlink', titre: 'starlink', date: hier }, maj: hier },
    { id: 'h2', col: 'historique', data: { url: 'https://starlink.com', titre: 'Starlink', date: hier + 1000 }, maj: hier + 1000 },
  ]);
  m.copier('p1', 'à la demande');
  m.appliquer('p1', 'a_2', [{ id: 'f2', col: 'favoris', maj: now - 10, suppr: true }, { id: 'h2', col: 'historique', maj: now - 5, suppr: true }, { id: 'h3', col: 'historique', data: { url: 'https://b.yt', titre: 'B', date: now }, maj: now }]);
  m.appliquer('p2', 'a_3', [{ id: 'f9', col: 'favoris', data: { url: 'https://secret.yt' }, maj: now }, { id: 'h9', col: 'historique', data: { url: 'https://prive.yt', date: now }, maj: now }]);
  m.copier('p1', 'quotidienne');
}
/** Tout ce qu'un magasin contient, comparable (copies comprises). */
async function contenu(m: Magasin) {
  const snap = m.instantane(), copies: Record<string, unknown> = {};
  for (const pid of [...snap.profils.keys()].sort()) copies[pid] = await Promise.all(m.copies(pid).map(async (c) => ({ ...c, cols: (await m.support.lireCopie(pid, c.id))?.cols })));
  const profils = Object.fromEntries([...snap.profils].sort().map(([pid, p]) => [pid, { cols: Object.fromEntries([...p.cols].sort().map(([c, l]) => [c, [...l].sort((x, y) => (x.id < y.id ? -1 : 1))])), jourDe: Object.fromEntries([...p.jourDe].sort()) }]));
  return { prefs: snap.prefs, appareils: [...snap.appareils].sort((x, y) => (x.id < y.id ? -1 : 1)), profils, copies, empreintes: Object.fromEntries([...snap.profils.keys()].sort().map((pid) => [pid, m.empreintes(pid)])) };
}

test('Pégase dans la base : migration (identique avant/après), relance, base arrêtée puis revenue, relance sans base, retour en fichiers', { skip: SANS_PG, timeout: 180_000 }, async () => {
  const pg = await pgJetable(), dir = join(pg.home, 'valhalla', 'pegase');
  let now = Date.parse('2026-11-14T10:00:00Z'); const clock = () => now;
  const opts = { cible: { ...pg.cible, mode: 'machine' as const }, hringhorni: false, verifierMs: 300, log: silence };
  let b = new BaseOdin(pg.home, opts);
  try {
    // 1. Avant la base : Pégase en fichiers.
    const m = new Magasin(dir, clock); remplir(m, now);
    const avant = await contenu(m);
    assert.ok(existsSync(join(dir, 'p', 'p1', 'favoris.json')));
    // 2. La base arrive : migration automatique.
    utiliserBase(b); brancherPegase(m, b, { log: silence }); await b.demarrer();
    await lesMigrables().find((x) => x.id === 'pegase')!.attendre();
    assert.equal(etatPegase(m).support, 'base'); assert.ok(m.support instanceof SupportBase);
    assert.deepEqual(await contenu(m), avant, 'même contenu juste après la migration');
    const secours = readdirSync(dir).find((x) => x.startsWith('avant-base-'));
    assert.ok(secours && existsSync(join(dir, secours, 'p', 'p1', 'favoris.json')) && existsSync(join(dir, secours, 'appareils.json')), 'copie de secours des fichiers');
    assert.ok(!existsSync(join(dir, 'p')) && existsSync(join(dir, 'en-base.json')), 'les données vivent dans la base');
    assert.ok(isSecretFile(join(dir, secours!, 'appareils.json')) && isSecretFile(join(dir, '.attente-base.jsonl')), 'copie de secours et journal d\'attente : bloqués');
    // 3. Odin relancé : tout est relu dans la base, identique.
    await b.arreter(); utiliserBase(undefined);
    b = new BaseOdin(pg.home, opts); const m2 = new Magasin(dir, clock); utiliserBase(b); brancherPegase(m2, b, { log: silence });
    assert.throws(() => m2.personnes(), BaseAttente, 'avant la lecture : « base pas prête », jamais un magasin vide');
    await b.demarrer(); await lesMigrables().find((x) => x.id === 'pegase')!.attendre();
    assert.deepEqual(await contenu(m2), avant, 'même contenu après relance (lu dans la base)');
    // 4. Base arrêtée pendant qu'Odin tourne : la synchro continue (mémoire), les écritures attendent sur le disque.
    await pg.arreter(); await attendre(() => b.etat === 'perdue');
    now += 60_000;
    const r = m2.appliquer('p1', 'a_1', [{ id: 'f3', col: 'favoris', data: { url: 'https://nouveau.yt' }, maj: now }, { id: 'h4', col: 'historique', data: { url: 'https://c.yt', date: now }, maj: now }]);
    assert.equal(r.appliques, 2); m2.setPrefs('p2', { voir: 'sans-historique' });
    await attendre(() => (m2.support as SupportBase).appli.attente.taille >= 2);
    assert.match(etatPegase(m2).message, /en attente sur le disque/);
    // 5. Odin relancé PENDANT que PostgreSQL est arrêté : il démarre, dit « base pas prête », ne perd rien.
    await b.arreter(); utiliserBase(undefined);
    b = new BaseOdin(pg.home, opts); const m3 = new Magasin(dir, clock); utiliserBase(b); brancherPegase(m3, b, { log: silence });
    await b.demarrer(); assert.notEqual(b.etat, 'prete');
    assert.throws(() => m3.col('p1', 'favoris'), BaseAttente);
    // 6. La base revient : le journal d'attente part d'abord, puis tout est relu.
    await pg.relancer(); await attendre(() => b.etat === 'prete'); await lesMigrables().find((x) => x.id === 'pegase')!.attendre();
    assert.equal(m3.col('p1', 'favoris').get('f3')?.data.url, 'https://nouveau.yt', 'l\'écriture faite base arrêtée est là');
    assert.equal(m3.col('p1', 'historique').has('h4'), true); assert.equal(m3.prefs('p2').voir, 'sans-historique');
    assert.deepEqual(m3.empreintes('p1'), m2.empreintes('p1'), 'même empreinte que l\'Odin d\'avant');
    // Conflit rejoué dans la base : un changement plus ancien ne gagne pas.
    m3.appliquer('p1', 'a_9', [{ id: 'f3', col: 'favoris', data: { url: 'https://vieux.yt' }, maj: now - 1 }]);
    const ap = b.appli({ id: 'pegase', migrations: [], ecritures: {} }, dir); await ap.vider();
    assert.deepEqual((await ap.q('SELECT data->>$1 FROM enregistrements WHERE id = $2', ['url', 'f3'])).rows, [['https://nouveau.yt']]);
    // Restaurer une copie (lue dans la base).
    const c = m3.copies('p1').find((x) => x.raison === 'à la demande')!; now += 1000;
    const rr = await m3.restaurer('p1', c.id); assert.ok(rr.changes >= 2);
    assert.equal(m3.col('p1', 'favoris').get('f2')?.suppr, undefined, 'f2 revient'); assert.equal(m3.col('p1', 'favoris').get('f3')?.suppr, true, 'f3 effacé');
    // 7. Odin (l'IA) lit la base par Alexandrie : vues oui (historique de p1 qui laisse tout voir, pas celui de p2), tables non, écriture non.
    const v = new Valhalla(pg.home, [urdr]);
    let q = await v.act('urdr', 'sql', { base: 'odin', requete: 'select adresse from pegase.v_historique order by quand' });
    assert.match(q.text, /starlink/); assert.doesNotMatch(q.text, /prive\.yt/, 'historique d\'un profil qui ne laisse pas voir : caché');
    q = await v.act('urdr', 'sql', { base: 'odin', requete: 'select jeton, ip from pegase.appareils' }); assert.match(q.text, /permission denied/);
    q = await v.act('urdr', 'sql', { base: 'odin', requete: 'select * from pegase.v_appareils' }); assert.doesNotMatch(q.text, /192\.168/, 'jamais l\'adresse IP');
    // 8. Retour en fichiers : un Odin sans base relit exactement la même chose.
    const apresBase = await contenu(m3);
    const t = await lesMigrables().find((x) => x.id === 'pegase')!.retour(); assert.match(t, /revenu en fichiers/);
    assert.equal(m3.support.nom, 'fichiers'); assert.ok(existsSync(join(dir, 'fichiers.json')) && !existsSync(join(dir, 'en-base.json')));
    await b.arreter(); utiliserBase(undefined);
    const m4 = new Magasin(dir, clock);
    assert.deepEqual(await contenu(m4), apresBase, 'même contenu après le retour en fichiers');
  } finally { utiliserBase(undefined); await b.arreter(); await pg.fin(); }
});

test('Pégase : une écriture rejouée ne double rien (règle des écritures rejouables)', { skip: SANS_PG, timeout: 60_000 }, async () => {
  const pg = await pgJetable(), dir = join(pg.home, 'valhalla', 'pegase');
  const b = new BaseOdin(pg.home, { cible: pg.cible, hringhorni: false, log: silence });
  try {
    await b.demarrer();
    const { DEF_PEGASE } = await import('../src/valhalla/pegase/base.ts');
    const a = b.appli(DEF_PEGASE, dir); await attendre(() => a.prete);
    const l: Rec[] = [{ id: 'f1', col: 'favoris', data: { url: 'x' }, maj: 5, appareil: 'a_1' }];
    const ligne = ['recs', 'p1', JSON.stringify(l.map((r) => ({ ...r, suppr: false, jour: null })))] as [string, string, string];
    a.ecrire(ligne, ligne); a.ecrire(['copie', 'p1', 'c1', 1, 'à la demande', '{}', '{}'], ['copie', 'p1', 'c1', 1, 'à la demande', '{}', '{}']); await a.vider();
    assert.deepEqual((await a.q('SELECT count(*) FROM enregistrements')).rows, [['1']]);
    assert.deepEqual((await a.q('SELECT count(*) FROM copies')).rows, [['1']]);
  } finally { await b.arreter(); await pg.fin(); }
});
