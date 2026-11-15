// Les échanges entre applis en direct : quand une appli en appelle une autre, un petit événement (qui, à qui, quelle
// action, demande ou réponse) part vers les pages ouvertes, sans aucune donnée de l'appel ; et la logique des graphes
// qui fait briller le lien (comète vers l'appli à qui on demande, réponse qui revient, regroupement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { Valhalla } from '../src/valhalla/service.ts';
import type { Module } from '../src/valhalla/types.ts';
import { echangeBus, echangesRecents, noterEchange, viderEchanges, type Echange } from '../src/valhalla/echanges.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { makeOdin } from './helpers.ts';

const SECRET = 'mot-de-passe-tres-secret-42';
const mod = (id: string, name: string, actions: Module['actions']): Module => ({ id, name, family: 'Données', what: 'essai', does: [], from: [], upstream: [], words: [], actions, view: () => ({ sections: [] }) });

test('un appel entre applis émet la demande puis la réponse, sans aucune donnée, et pas pour une action lancée par toi', async () => {
  const home = mkdtempSync(join(tmpdir(), 'echanges-'));
  const arche = mod('arche', 'Arche', [
    { id: 'site2', label: 'Vérifier le 2e site', what: 'essai', read: true, run: (_c, i) => ({ text: `vu ${String(i.cle).length}` }) },
    { id: 'casse', label: 'Casser', what: 'essai', read: true, run: () => { throw new Error('en panne'); } },
  ]);
  const sindri = mod('sindri', 'Phénix', [
    { id: 'go', label: 'Aller', what: 'essai', read: true, run: async (c) => ({ text: (await c.call('arche', 'site2', { cle: SECRET, mot_de_passe: SECRET })).text }) },
    { id: 'rate', label: 'Rater', what: 'essai', read: true, run: async (c) => ({ text: (await c.call('arche', 'casse', { cle: SECRET }, undefined, { interne: true })).text }) },
    { id: 'soi', label: 'Soi', what: 'essai', read: true, run: async (c) => ({ text: (await c.call('sindri', 'go')).text }) },
  ]);
  const v = new Valhalla(home, [arche, sindri], { notify: async () => {} });
  const vus: Echange[] = [], parV: Echange[] = [], f = (e: Echange) => vus.push(e), g = (e: Echange) => parV.push(e);
  viderEchanges(); echangeBus.on('echange', f); v.events.on('echange', g);
  try {
    // Action lancée par toi depuis l'interface : rien.
    assert.equal((await v.act('arche', 'site2', { cle: 'x' })).ok, true);
    assert.equal(vus.length, 0);

    // Phénix demande à Arche : demande puis réponse, même numéro, seulement les identifiants et les noms.
    assert.equal((await v.act('sindri', 'go')).ok, true);
    assert.deepEqual(vus.map((e) => [e.de, e.vers, e.action, e.phase, e.ok]), [['sindri', 'arche', 'site2', 'demande', true], ['sindri', 'arche', 'site2', 'reponse', true]]);
    assert.equal(vus[0].id, vus[1].id);
    assert.deepEqual([vus[0].deNom, vus[0].versNom, vus[0].libelle], ['Phénix', 'Arche', 'Vérifier le 2e site']);
    for (const e of vus) {
      assert.deepEqual(Object.keys(e).sort(), ['action', 'at', 'de', 'deNom', 'id', 'libelle', 'ok', 'phase', 'vers', 'versNom']);
      assert.ok(!JSON.stringify(e).includes(SECRET), 'aucune donnée de l\'appel');
      assert.ok(!Number.isNaN(Date.parse(e.at)));
    }
    assert.equal(parV.length, 2, 'aussi sur les événements de Valhalla');

    // Une étape interne qui échoue : la réponse dit « échec ».
    await v.act('sindri', 'rate');
    assert.deepEqual(vus.slice(-2).map((e) => [e.vers, e.action, e.phase, e.ok]), [['arche', 'casse', 'demande', true], ['arche', 'casse', 'reponse', false]]);

    // Une appli qui s'appelle elle-même : pas d'échange entre applis (seul l'appel de Phénix vers Arche compte).
    const avant = vus.length; await v.act('sindri', 'soi');
    assert.ok(vus.slice(avant).every((e) => e.de === 'sindri' && e.vers === 'arche'));

    // L'historique des dernières secondes, filtré selon les droits de la personne.
    assert.ok(echangesRecents().length >= 4);
    assert.equal(echangesRecents((id) => id !== 'arche').length, 0);
    assert.ok(!JSON.stringify(echangesRecents()).includes(SECRET));
  } finally { echangeBus.off('echange', f); v.events.off('echange', g); v.stop(); viderEchanges(); rmSync(home, { recursive: true, force: true }); }
});

test('beaucoup d\'échanges identiques d\'un coup : un seul relayé', () => {
  viderEchanges();
  const e = (n: number): Echange => ({ id: n, de: 'a', vers: 'b', action: 'x', phase: 'demande', ok: true, at: new Date(1000).toISOString(), deNom: 'A', versNom: 'B', libelle: 'X' });
  assert.equal(noterEchange(e(1), 1000), true);
  assert.equal(noterEchange(e(2), 1100), false);
  assert.equal(noterEchange(e(3), 1300), true);
  viderEchanges();
});

test('les échanges sont relayés en direct aux pages ouvertes, avec l\'historique pour la page qui s\'ouvre', async () => {
  const o = makeOdin([]);
  const port = 21000 + Math.floor(Math.random() * 20000), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: () => gw.scanNetwork(false) }, { port, host: '127.0.0.1', token, scryptN: 1024 }));
  await gw.start();
  const B = `http://127.0.0.1:${port}`, auth = { authorization: `Bearer ${token}` };
  const ctrl = new AbortController();
  viderEchanges();
  try {
    const lire = async () => {
      const r = await fetch(`${B}/api/stream`, { headers: auth, signal: ctrl.signal }); assert.equal(r.status, 200);
      const reader = r.body!.getReader(); let buf = '';
      const attendre = async (re: RegExp) => { while (!re.test(buf)) { const { value, done } = await reader.read(); if (done) break; buf += new TextDecoder().decode(value); } return buf; };
      return attendre;
    };
    const attendre = await lire(); await attendre(/: ok/);
    noterEchange({ id: 7, de: 'sindri', vers: 'arche', action: 'site2', phase: 'demande', ok: true, at: new Date().toISOString(), deNom: 'Phénix', versNom: 'Arche', libelle: 'Vérifier le 2e site' });
    const buf = await attendre(/"type":"echange"/);
    assert.match(buf, /"de":"sindri","vers":"arche","action":"site2","phase":"demande"/);
    // Une page qui s'ouvre juste après reçoit les dernières secondes.
    const attendre2 = await lire();
    assert.match(await attendre2(/"type":"echanges"/), /"maintenant":\d+,"list":\[\{"id":7/);
  } finally { ctrl.abort(); await gw.stop(); viderEchanges(); }
});

// ---------- La logique du graphe (graph.js), chargée hors navigateur ----------
function graphe() {
  const window: Record<string, unknown> = {};
  runInNewContext(readFileSync(new URL('../src/web/graph.js', import.meta.url), 'utf8'), { window });
  return window.OdinGraph as {
    moteurEchanges(now: () => number): {
      recevoir(x: unknown, maintenant?: number): void;
      actifs(t?: number): Array<{ de: string; vers: string; n: number; ok: boolean; force: number; impulsions: Array<{ sens: string; p: number; x: number; ok: boolean }> }>;
      etiquette(l: unknown): string;
      dessiner(ctx: unknown, o: unknown): Array<{ ax: number; ay: number; bx: number; by: number; texte: string }>;
    };
    survolEchange(segs: unknown, p: { x: number; y: number }, k?: number): string;
  };
}
const ev = (phase: 'demande' | 'reponse', o: Partial<Echange> = {}): Echange => ({ id: 1, de: 'sindri', vers: 'arche', action: 'site2', phase, ok: true, at: new Date(0).toISOString(), deNom: 'Phénix', versNom: 'Arche', libelle: 'Vérifier le 2e site', ...o });

test('graphe : la comète va vers l\'appli à qui on demande, la réponse revient après, puis le lien s\'éteint', () => {
  let t = 0; const G = graphe(), m = G.moteurEchanges(() => t);
  m.recevoir(ev('demande'));
  t = 100; let a = m.actifs();
  assert.equal(a.length, 1); assert.equal(`${a[0].de}>${a[0].vers}`, 'sindri>arche');
  assert.deepEqual(a[0].impulsions.map((p) => p.sens).join(), 'aller'); assert.ok(a[0].impulsions[0].p > 0 && a[0].impulsions[0].p < 0.2);
  assert.equal(m.etiquette(a[0]), 'Phénix demande à Arche : vérifier le 2e site');
  // Réponse rapide : elle ne repart qu'une fois la demande arrivée (les deux ne se croisent pas).
  t = 150; m.recevoir(ev('reponse', { ok: false }));
  t = 600; assert.deepEqual(m.actifs()[0].impulsions.map((p) => p.sens).join(), 'aller');
  t = 1250; a = m.actifs(); assert.deepEqual(a[0].impulsions.map((p) => p.sens).join(), 'retour'); assert.equal(a[0].impulsions[0].ok, false);
  assert.match(m.etiquette(a[0]), /— échec$/);
  t = 10_000; assert.equal(m.actifs().length, 0);
});

test('graphe : beaucoup d\'échanges regroupés (une impulsion par paquet, 40 liens au plus), historique rejoué à sa date', () => {
  let t = 0; const G = graphe(), m = G.moteurEchanges(() => t);
  for (let i = 0; i < 10; i++) { t = i * 10; m.recevoir(ev('demande')); }
  let a = m.actifs(); assert.equal(a.length, 1); assert.equal(a[0].n, 10);
  assert.equal(a[0].impulsions.length, 1); assert.equal(a[0].impulsions[0].x, 10);
  for (let i = 0; i < 60; i++) m.recevoir(ev('demande', { de: `a${i}`, vers: `b${i}` }));
  assert.equal(m.actifs().length, 40);
  // L'historique envoyé à l'ouverture : rejoué selon l'heure du serveur ; trop ancien → ignoré.
  t = 50_000; const m2 = G.moteurEchanges(() => t), serveur = 1_000_000;
  m2.recevoir([ev('demande', { at: new Date(serveur - 2000).toISOString() }), ev('demande', { de: 'vieux', at: new Date(serveur - 8000).toISOString() })], serveur);
  a = m2.actifs(); assert.equal(a.length, 1); assert.equal(a[0].de, 'sindri');
  assert.equal(a[0].impulsions.length, 0, 'la comète de il y a 2 s est déjà arrivée');
});

test('graphe : dessin (blanc, pointillé si pas de lien, sans mouvement si demandé) et étiquette au survol', () => {
  let t = 0; const G = graphe(), m = G.moteurEchanges(() => t);
  const appels: Array<[string, unknown[]]> = [];
  const ctx = new Proxy({} as Record<string, unknown>, { get: (o, k: string) => (k in o ? o[k] : (...args: unknown[]) => { appels.push([k, args]); return { addColorStop: () => {} }; }), set: (o, k: string, v) => { o[k] = v; appels.push([`=${k}`, [v]]); return true; } });
  const pos: Record<string, { id: string; x: number; y: number; r: number }> = { sindri: { id: 'sindri', x: 0, y: 0, r: 10 }, arche: { id: 'arche', x: 200, y: 0, r: 10 } };
  m.recevoir(ev('demande')); t = 300;
  const segs = m.dessiner(ctx, { k: 1, noeud: (id: string) => pos[id], relies: () => false });
  assert.equal(segs.length, 1);
  assert.ok(appels.some(([k, a]) => k === '=strokeStyle' && a[0] === '#FFFFFF'), 'lien blanc');
  assert.ok(appels.some(([k, a]) => k === 'setLineDash' && (a[0] as number[]).length === 2), 'pointillé : lien absent du graphe');
  assert.ok(appels.some(([k]) => k === 'createLinearGradient'), 'la comète');
  assert.equal(G.survolEchange(segs, { x: 100, y: 3 }), 'Phénix demande à Arche : vérifier le 2e site');
  assert.equal(G.survolEchange(segs, { x: 100, y: 40 }), '');
  // Mouvement réduit : le lien blanc et la flèche, sans comète ni onde.
  appels.length = 0;
  m.dessiner(ctx, { k: 1, reduit: true, noeud: (id: string) => pos[id], relies: () => true });
  assert.ok(!appels.some(([k]) => k === 'createLinearGradient' || k === 'arc'));
  assert.ok(appels.some(([k]) => k === 'fill'), 'la flèche fixe');
  assert.ok(!appels.some(([k, a]) => k === 'setLineDash' && (a[0] as number[]).length === 2), 'lien existant : trait plein');
  // Appli absente du graphe : rien n'est dessiné.
  assert.equal(m.dessiner(ctx, { k: 1, noeud: () => undefined }).length, 0);
});
