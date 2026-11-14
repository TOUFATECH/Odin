// Les journaux et historiques des applis dans la base d'Odin, avec un VRAI serveur PostgreSQL jetable : fil d'alertes,
// bulles de la mascotte, historique d'Arche, connexions de Persona. Migration (identique avant/après, copie de
// secours), base arrêtée puis revenue (rien n'est perdu), Odin relancé (relu dans la base), lecture par Odin (vues,
// sans adresse IP), retour en fichiers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pgDisponible, pgJetable } from './banc/pg-jetable.ts';
import { BaseOdin, lesMigrables, utiliserBase } from '../src/valhalla/base/index.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { Notices } from '../src/valhalla/notices.ts';
import { urdr } from '../src/valhalla/modules/urdr.ts';
import { history, skuld } from '../src/valhalla/modules/skuld.ts';
import { varModule } from '../src/valhalla/modules/var.ts';
import { noter } from '../src/valhalla/sso/etat.ts';
import { connexions } from '../src/valhalla/sso/connexions.ts';
import { isSecretFile } from '../src/heimdall/policy.ts';

const SANS_PG = !pgDisponible() && 'PostgreSQL (initdb, pg_ctl) absent de la machine';
const attendre = async (f: () => boolean | Promise<boolean>, ms = 20_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('délai dépassé'); };
const silence = () => undefined;
const tousPrets = async () => { for (const m of lesMigrables()) await m.attendre(); };

test('journaux dans la base : alertes, bulles, historique d\'Arche, connexions de Persona ; base arrêtée puis revenue ; relance ; retour', { skip: SANS_PG, timeout: 180_000 }, async () => {
  const pg = await pgJetable(), home = pg.home;
  const opts = { cible: { ...pg.cible, mode: 'machine' as const }, hringhorni: false, verifierMs: 300, log: silence };
  let v = new Valhalla(home, [urdr, skuld, varModule]), n = new Notices(v), b: BaseOdin | undefined;
  try {
    // 1. Avant la base : les fichiers d'avant.
    for (let i = 0; i < 12; i++) v.alert('urdr', { level: i % 3 ? 'info' : 'haute', title: `Alerte ${i}`, detail: `détail ${i} — l'apostrophe`, key: `k${i}` });
    n.add({ level: 'ok', module: 'urdr', title: 'Bulle témoin', source: 'info' });
    writeFileSync(join(v.ctx('skuld').dir, 'historique.jsonl'), [{ at: '2026-11-13T03:00:00.000Z', base: 'compta', ok: true, taille: 1234, raison: 'nuit', ms: 50 }, { at: '2026-11-14T03:00:00.000Z', base: 'compta', ok: false, erreur: 'disque plein', ms: 3 }].map((x) => JSON.stringify(x)).join('\n') + '\n');
    noter(v.ctx('var'), { login: 'awa', ip: '192.168.1.30', ok: true, why: 'mot de passe' });
    noter(v.ctx('var'), { login: 'awa', ip: '203.0.113.9', ok: false, why: 'mot de passe faux' });
    const avant = { alertes: v.alerts({ limit: 1000 }), bulles: n.recent(50), arche: history(v.ctx('skuld')), cx: connexions(v.ctx('var')).tout() };
    assert.equal(avant.alertes.length, 12); assert.equal(avant.arche.length, 2); assert.equal(avant.cx.length, 2);
    assert.ok(existsSync(join(v.dir, 'alertes.jsonl')));
    // 2. La base arrive : chaque journal y passe tout seul.
    b = new BaseOdin(home, opts); utiliserBase(b); await b.demarrer(); await tousPrets();
    assert.deepEqual(lesMigrables().map((m) => m.etat().support).sort(), ['base', 'base', 'base', 'base']);
    assert.deepEqual(v.alerts({ limit: 1000 }), avant.alertes, 'alertes identiques');
    assert.deepEqual(n.recent(50), avant.bulles, 'bulles identiques');
    assert.deepEqual(history(v.ctx('skuld')), avant.arche, 'historique d\'Arche identique');
    assert.deepEqual(connexions(v.ctx('var')).tout(), avant.cx, 'connexions identiques');
    assert.ok(!existsSync(join(v.dir, 'alertes.jsonl')) && !existsSync(join(v.ctx('skuld').dir, 'historique.jsonl')), 'les fichiers d\'avant sont vidés…');
    assert.equal(v.ctx('var').settings.journal, undefined, '… et le journal sort des réglages de Persona');
    const secours = readdirSync(join(v.dir, 'avant-base')); assert.ok(secours.some((f) => f.startsWith('alertes.')), '… après une copie de secours');
    assert.ok(isSecretFile(join(v.dir, 'avant-base', secours[0])) && isSecretFile(join(v.ctx('var').dir, 'avant-base', 'connexions.x.jsonl')));
    // 3. Base arrêtée : la nouvelle alerte et la nouvelle connexion se voient tout de suite, et attendent sur le disque.
    await pg.arreter(); await attendre(() => b!.etat === 'perdue');
    v.alert('urdr', { level: 'critique', title: 'Pendant la panne', key: 'panne' }); noter(v.ctx('var'), { login: 'nour', ip: '10.0.0.2', ok: true, why: 'mot de passe' });
    assert.equal(v.alerts({ limit: 1 })[0].title, 'Pendant la panne');
    await pg.relancer(); await attendre(() => b!.etat === 'prete'); await tousPrets();
    // 4. Odin relancé : tout est relu dans la base.
    v.stop(); n.stop(); await b.arreter(); utiliserBase(undefined);
    v = new Valhalla(home, [urdr, skuld, varModule]); n = new Notices(v); connexions(v.ctx('var')); history(v.ctx('skuld'));
    b = new BaseOdin(home, opts); utiliserBase(b); await b.demarrer(); await tousPrets();
    const l = v.alerts({ limit: 1000 }); assert.equal(l.length, 13); assert.equal(l[0].title, 'Pendant la panne', 'l\'alerte de la panne est là, la plus récente');
    assert.deepEqual(l.slice(1), avant.alertes); assert.deepEqual(n.recent(50).slice(1), avant.bulles, 'la bulle de la panne, puis celles d\'avant');
    assert.deepEqual(connexions(v.ctx('var')).tout().map((x) => x.login), ['awa', 'awa', 'nour']);
    // 5. Odin lit les journaux pour répondre : les vues, jamais l'adresse IP des connexions.
    let q = await v.act('urdr', 'sql', { base: 'odin', requete: 'select titre, niveau from journaux.v_alertes order by quand desc limit 3' }); assert.match(q.text, /Pendant la panne/);
    q = await v.act('urdr', 'sql', { base: 'odin', requete: 'select * from journaux.v_connexions' }); assert.match(q.text, /nour/); assert.doesNotMatch(q.text, /192\.168|203\.0|10\.0\.0/);
    q = await v.act('urdr', 'sql', { base: 'odin', requete: 'select base, reussie, erreur from journaux.v_sauvegardes' }); assert.match(q.text, /disque plein/);
    q = await v.act('urdr', 'sql', { base: 'odin', requete: 'select donnees from journaux.entrees' }); assert.match(q.text, /permission denied/);
    // Le journal des requêtes d'Alexandrie passe lui aussi dans la base (et garde ces requêtes).
    await lesMigrables().find((m) => m.id === 'journal:requetes')!.attendre();
    assert.equal(lesMigrables().find((m) => m.id === 'journal:requetes')!.etat().support, 'base');
    assert.equal((await v.act('urdr', 'journal')).text.split('\n').length >= 4, true);
    // 6. Retour en fichiers (Alexandrie) : le fichier est réécrit, identique.
    const r = await v.act('urdr', 'base_retour', { appli: 'journal:alertes' }); assert.match(r.text, /revenu en fichiers \(13 entrée/);
    assert.ok(existsSync(join(v.dir, 'alertes.jsonl')));
    v.stop(); n.stop(); await b.arreter(); utiliserBase(undefined); b = undefined;
    const v2 = new Valhalla(home, [urdr]); assert.deepEqual(v2.alerts({ limit: 1000 }).map((a) => a.title), l.map((a) => a.title), 'mêmes alertes, relues dans le fichier');
  } finally { v.stop(); n.stop(); utiliserBase(undefined); await b?.arreter(); await pg.fin(); }
});

test('journaux : Iðunn, Rödd, Forge par journalDe ; migration versionnée (v2 : vue des événements des sites)', { skip: SANS_PG, timeout: 120_000 }, async () => {
  const { journalDe } = await import('../src/valhalla/base/journal.ts');
  const pg = await pgJetable(), ctx = { dir: join(pg.home, 'valhalla', 'idunn') };
  const b = new BaseOdin(pg.home, { cible: pg.cible, hringhorni: false, log: silence });
  try {
    const j = journalDe<{ at: string; site: string; type: string; level: string; text: string }>(ctx, 'idunn', 'evenements.jsonl', { garder: 5000 });
    j.ajouter({ at: '2026-11-14T08:00:00.000Z', site: 'toufatech.yt', type: 'panne', level: 'haute', text: 'le site ne répond plus' });
    assert.ok(existsSync(join(ctx.dir, 'evenements.jsonl')), 'sans base : le fichier d\'avant');
    utiliserBase(b); await b.demarrer(); await tousPrets();
    assert.equal(j.support, 'base'); assert.equal(j.tout().length, 1);
    const v = new Valhalla(pg.home, [urdr]);
    const q = await v.act('urdr', 'sql', { base: 'odin', requete: 'select site, niveau, texte from journaux.v_evenements_sites' });
    assert.match(q.text, /toufatech\.yt \| haute \| le site ne répond plus/);
    const a = b.applisBranchees().find((x) => x.id === 'journaux')!;
    assert.deepEqual((await a.q('SELECT version, nom FROM _migrations ORDER BY version')).rows.map((x) => x[0]), ['1', '2']);
  } finally { utiliserBase(undefined); await b.arreter(); await pg.fin(); }
});
