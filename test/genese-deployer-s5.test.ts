// Genèse · Déployer, lot S5 (côté serveur) : l'action en lecture « postes_vus » rend les PC vus au menu de démarrage
// réseau, à partir de ce que le serveur de démarrage sait déjà (fiches vivantes, historique, PC autorisés, PC bloqués).
// Une adresse MAC invalide, nulle, de diffusion ou de groupe n'est jamais un PC ; un nom de PC reste du texte ; rien
// n'est écrit ; seul le propriétaire la lit (ni un membre, ni une automatisation, ni la clé d'API, ni une tablette).
// Données fausses, dossiers temporaires neufs, aucun réseau, aucun serveur de démarrage lancé.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as T from '../src/valhalla/modules/thjalfi.ts';
import type { Module } from '../src/valhalla/types.ts';

const X = T as unknown as Record<string, any>;
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-s5-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const NOW = new Date(2026, 10, 23, 12, 0).getTime();
const MIN = 60_000;
const SOURCE = () => ({
  live: {
    '52:54:00:3a:91:0c': { mac: '52:54:00:3a:91:0c', fw: 'uefi', step: 'menu', updated: NOW - 20_000, started: NOW - 60_000, steps: [], marque: 'Lenovo', modele: 'ThinkCentre M70q', serie: 'PC1A2B3C' },
    '52:54:00:7e:12:a4': { mac: '52:54:00:7e:12:a4', fw: 'uefi', step: 'menu', updated: NOW - 4 * MIN - 50_000, started: NOW - 6 * MIN, steps: [] },
    '52:54:00:aa:bb:cc': { mac: '52:54:00:aa:bb:cc', fw: 'bios', step: 'installation', updated: NOW - 2 * MIN, started: NOW - 20 * MIN, steps: [], host: 'atelier-2' },
    'ff:ff:ff:ff:ff:ff': { mac: 'ff:ff:ff:ff:ff:ff', fw: 'uefi', step: 'menu', updated: NOW, started: NOW, steps: [] },
    '01:00:5e:00:00:01': { mac: '01:00:5e:00:00:01', fw: 'uefi', step: 'menu', updated: NOW, started: NOW, steps: [] },
    'pas-une-mac': { mac: 'pas-une-mac', fw: 'uefi', step: 'menu', updated: NOW, started: NOW, steps: [] },
  },
  historique: [
    { at: NOW - 2 * 3600_000, mac: '52:54:00:c1:5b:77', host: 'Portable-03', iso: 'ubuntu-22', isoName: 'ubuntu-22.04.4-desktop-amd64', result: 'fini', ms: 1, fw: 'bios' },
    { at: NOW - 30 * 3600_000, mac: '52:54:00:c1:5b:77', host: 'ancien-nom', iso: 'debian', isoName: 'debian-12', result: 'fini', ms: 1 },
    { at: NOW - 3 * 3600_000, mac: '00:00:00:00:00:00', isoName: 'rien', result: 'fini', ms: 1 },
  ],
  regles: [{ mac: '52-54-00-08-E2-3D', nom: 'PC-04', auto: false, ajoute: 1 }, { mac: '52:54:00:7e:12:a4', nom: 'PC-02', auto: false, ajoute: 1 }],
  bloques: { '52:54:00:08:e2:3d': { at: NOW - 3600_000, raison: 'prêté' } },
});

test('S5 · macPoste : six paires vérifiées ; nulle, diffusion, groupe, trop longue ou mal écrite refusées', () => {
  assert.equal(typeof X.macPoste, 'function', 'macPoste exporté par modules/thjalfi.ts');
  assert.equal(X.macPoste('52:54:00:12:34:56'), '52:54:00:12:34:56');
  assert.equal(X.macPoste('52-54-00-12-34-AB'), '52:54:00:12:34:ab');
  assert.equal(X.macPoste('525400123456'), '52:54:00:12:34:56');
  assert.equal(X.macPoste(' 52:54:00:12:34:56 '), '52:54:00:12:34:56');
  for (const m of ['ff:ff:ff:ff:ff:ff', 'FF-FF-FF-FF-FF-FF', '00:00:00:00:00:00', '01:00:5e:00:00:01', '33:33:00:00:00:01', '52:54:00:12:34', '52:54:00:12:34:56:78', '52:54:00-12:34:56', 'zz:54:00:12:34:56', '', 'x'.repeat(5000), '52:54:00:12:34:56\n', '<b>52:54:00:12:34:56</b>', undefined, 42])
    assert.equal(X.macPoste(m), '', `refusée : ${JSON.stringify(m)}`);
});

test('S5 · postesVus : chaque PC une fois, « au menu » seulement s\'il y est en ce moment, bloqué et autorisé, dernière installation', () => {
  assert.equal(typeof X.postesVus, 'function', 'postesVus exporté par modules/thjalfi.ts');
  const l = X.postesVus({ ...SOURCE(), now: NOW }) as Array<Record<string, any>>;
  const p = (mac: string) => l.find((x) => x.mac === mac)!;
  assert.deepEqual(l.map((x) => x.mac).sort(), ['52:54:00:08:e2:3d', '52:54:00:3a:91:0c', '52:54:00:7e:12:a4', '52:54:00:aa:bb:cc', '52:54:00:c1:5b:77'], 'diffusion, groupe, nulle et texte libre écartés ; aucun doublon');
  assert.equal(l[0].mac, '52:54:00:3a:91:0c', 'le PC au menu en premier');
  const a = p('52:54:00:3a:91:0c');
  assert.equal(a.auMenu, true); assert.equal(a.fw, 'uefi'); assert.equal(a.marque, 'Lenovo'); assert.equal(a.modele, 'ThinkCentre M70q'); assert.equal(a.serie, 'PC1A2B3C');
  assert.equal(a.vu, NOW - 20_000); assert.equal(a.bloque, false); assert.equal(a.autorise, false);
  const b = p('52:54:00:7e:12:a4');
  assert.equal(b.auMenu, true, 'au menu il y a 4 min 50 s'); assert.equal(b.nom, 'PC-02', 'le nom donné par le propriétaire'); assert.equal(b.autorise, true);
  assert.equal(p('52:54:00:aa:bb:cc').auMenu, false, 'en pleine installation : pas au menu');
  assert.equal(p('52:54:00:aa:bb:cc').nom, 'atelier-2');
  const c = p('52:54:00:c1:5b:77');
  assert.equal(c.nom, 'Portable-03', 'le nom le plus récent'); assert.deepEqual(c.installe, { image: 'ubuntu-22.04.4-desktop-amd64', le: NOW - 2 * 3600_000 });
  assert.equal(c.vu, NOW - 2 * 3600_000); assert.equal(c.auMenu, false);
  const d = p('52:54:00:08:e2:3d');
  assert.equal(d.bloque, true); assert.equal(d.autorise, true); assert.equal(d.nom, 'PC-04'); assert.equal(d.vu, undefined, 'jamais vu : pas d\'heure inventée');
  // Un menu vieux de plus de 5 minutes : le PC a repris son disque.
  const vieux = X.postesVus({ ...SOURCE(), now: NOW + 10 * MIN }) as Array<Record<string, any>>;
  assert.equal(vieux.filter((x) => x.auMenu).length, 0);
  // Source vide ou abîmée : liste vide, jamais d'erreur.
  assert.deepEqual(X.postesVus({ live: null, historique: 'x', regles: {}, bloques: null, now: NOW }), []);
});

test('S5 · postesVus : un nom ou un modèle reste du texte (sans saut de ligne ni caractère invisible), borné', () => {
  const l = X.postesVus({ live: { a: { mac: '52:54:00:00:00:01', step: 'menu', updated: NOW, host: '<img src=x onerror=alert(1)>\u2028pc\u0007\u202e', modele: 'M'.repeat(500), marque: 'A\nB', fw: 'javascript:' } }, historique: [], regles: [], bloques: {}, now: NOW }) as Array<Record<string, any>>;
  assert.equal(l.length, 1);
  assert.equal(l[0].nom, '<img src=x onerror=alert(1)> pc', 'gardé tel quel en texte (la page l\'écrit comme du texte), sans caractère invisible');
  assert.doesNotMatch(l[0].nom, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
  assert.equal(l[0].marque, 'A B');
  assert.ok(l[0].modele.length <= 60);
  assert.equal(l[0].fw, undefined, 'un micrologiciel inconnu n\'est pas repris');
  // Au plus 200 PC rendus.
  const live: Record<string, unknown> = {};
  for (let i = 0; i < 600; i++) { const m = `52:54:00:00:${String((i >> 8).toString(16)).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`; live[m] = { mac: m, step: 'menu', updated: NOW - i }; }
  assert.equal(X.postesVus({ live, historique: [], regles: [], bloques: {}, now: NOW }).length, 200);
});

test('S5 · la carte d\'un système dit s\'il s\'installe tout seul (image dont la recette installe)', () => {
  const f = { id: 'u', nom: 'ubuntu.iso', chemin: 'E:/ISO/ubuntu.iso', taille: 1, antivirus: { verdict: 'sain' }, editeur: true, systeme: 'Linux', detail: 'Ubuntu 24.04.1' };
  const g = { id: 'g', nom: 'gparted.iso', chemin: 'E:/ISO/gparted.iso', taille: 1, antivirus: { verdict: 'sain' }, systeme: 'Autre', detail: 'GParted Live 1.6.0' };
  const d = X.assemblerSystemes({ fiches: [f, g], images: [{ id: 'ubuntu', chemin: 'E:/ISO/ubuntu.iso', demarre: true, prete: true, auto: true }, { id: 'gparted', chemin: 'E:/ISO/gparted.iso', demarre: true, prete: true }], disponibles: [], surveilles: [], historique: '', now: NOW });
  const u = d.cartes.find((c: Record<string, unknown>) => c.iso === 'ubuntu'), gp = d.cartes.find((c: Record<string, unknown>) => c.iso === 'gparted');
  assert.equal(u.installe, true, 's\'installe tout seul');
  assert.equal(gp.installe, undefined, 'démarre seulement');
});

// ------------------------------------------------------------------ l'action, par la vraie porte
function ymirFaux(): Module {
  return { id: 'ymir', name: 'Hydre', family: 'Essai', what: 'essai', does: [], from: [], upstream: [], words: [],
    actions: [{ id: 'creer_machine', label: 'Créer une machine', what: 'essai', run: async () => { throw new Error('jamais appelée dans ce lot'); } }] } as unknown as Module;
}

test('S5 · « postes_vus » : lecture, propriétaire seul, rien n\'est écrit ; une source simulée qui change est vue au tour suivant', async () => {
  assert.equal(typeof X.postesVusAction, 'function', 'postesVusAction exporté');
  let src = SOURCE();
  const a = X.postesVusAction(() => ({ ...src, allume: true, mode: 'proxy' }));
  assert.equal(a.id, 'postes_vus'); assert.equal(a.read, true); assert.equal(a.proprietaireSeul, true); assert.equal(a.grave, undefined);
  const dans = X.thjalfi().actions.find((x: Record<string, unknown>) => x.id === 'postes_vus');
  assert.ok(dans, 'action postes_vus dans Genèse'); assert.equal(dans.read, true); assert.equal(dans.proprietaireSeul, true);
  // Une source qui change : en direct.
  const ctx = { now: () => new Date(NOW), modules: () => [ymirFaux()] } as never;
  const r1 = await a.run(ctx, {});
  assert.equal(r1.ok, true); assert.equal(r1.data.allume, true); assert.equal(r1.data.mode, 'proxy'); assert.equal(r1.data.vm, true, 'Hydre sait créer une machine');
  assert.equal(r1.data.postes.filter((x: Record<string, unknown>) => x.auMenu).length, 2);
  src = { ...src, live: { ...src.live, '52:54:00:12:34:56': { mac: '52:54:00:12:34:56', fw: 'bios', step: 'démarrage réseau', updated: NOW - 1000, started: NOW - 1000, steps: [] } } as never };
  const r2 = await a.run(ctx, {});
  assert.ok(r2.data.postes.some((x: Record<string, unknown>) => x.mac === '52:54:00:12:34:56' && x.auMenu === true), 'le nouveau PC apparaît');
  assert.match(r2.text, /3 au menu/);
  const sansHydre = await a.run({ now: () => new Date(NOW), modules: () => [] } as never, {});
  assert.equal(sansHydre.data.vm, false, 'sans Hydre : la machine virtuelle est « bientôt »');
});

test('S5 · « postes_vus » par Genèse : fiches et réglages lus, aucun fichier écrit ; refusé à un membre, une automatisation, Odin seul, la clé d\'API', async () => {
  const { Valhalla } = await import('../src/valhalla/service.ts');
  const home = neuf('va');
  const v = new Valhalla(home, [X.thjalfi()], { fetch: (async () => { throw new Error('aucun réseau'); }) as never, run: async () => ({ code: 1, out: '', err: 'aucune commande' }), notify: async () => {} });
  try {
    await v.activer('thjalfi', true);
    // La fiche vivante d'un PC au menu, posée comme le serveur de démarrage la pose (le serveur, lui, n'est pas lancé).
    const dir = join(home, 'valhalla', 'thjalfi');
    const r0 = await v.act('thjalfi', 'postes_vus', {});
    assert.equal(r0.ok, true, r0.text);
    assert.deepEqual((r0.data as { postes: unknown[] }).postes, []);
    assert.equal((r0.data as { allume: boolean }).allume, false, 'Genèse éteint : aucun serveur lancé');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'machines-en-cours.json'), JSON.stringify({ '52:54:00:3a:91:0c': { mac: '52:54:00:3a:91:0c', fw: 'uefi', step: 'menu', updated: Date.now() - 1000, started: Date.now() - 2000, steps: [] } }));
    const fichiers = () => JSON.stringify(readdirSync(home, { recursive: true }).map(String).filter((f) => statSync(join(home, f)).isFile()).map((f) => `${f}:${statSync(join(home, f)).size}:${statSync(join(home, f)).mtimeMs}`).sort());
    const avant = fichiers();
    const r = await v.act('thjalfi', 'postes_vus', {});
    assert.equal(r.ok, true, r.text);
    const d = r.data as { postes: Array<Record<string, unknown>> };
    assert.equal(d.postes.length, 1); assert.equal(d.postes[0].mac, '52:54:00:3a:91:0c'); assert.equal(d.postes[0].auMenu, true);
    assert.equal(fichiers(), avant, 'aucun fichier écrit ni changé');
    for (const qui of [{ qui: 'member' as const }, { qui: 'guest' as const }, { auto: true }, { by: 'automatisation' as const }, { by: 'odin' as const }]) {
      const n = await v.act('thjalfi', 'postes_vus', {}, qui);
      assert.equal(n.ok, false, JSON.stringify(qui)); assert.match(n.text, /propriétaire/);
      assert.equal(n.data, undefined, 'rien ne fuit');
    }
    const { setValhalla } = await import('../src/valhalla/odin.ts');
    const { valhallaPost } = await import('../src/web/valhalla-api.ts');
    setValhalla(v);
    const api = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'postes_vus', input: {} }) as { ok: boolean; code?: string; data?: unknown };
    assert.equal(api.ok, false); assert.equal(api.code, 'proprietaire'); assert.equal(api.data, undefined);
    const p = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'postes_vus', input: {} }, { sessionProprio: true }) as { ok: boolean };
    assert.equal(p.ok, true, 'depuis la session du propriétaire');
  } finally { v.stop(); }
});

test('S5 · une tablette « maison » ne lit pas les PC vus (bouton de sa page refusé)', async () => {
  const { T: Banc } = await import('./banc/lib.ts');
  const { vraiOdin } = await import('./banc/odin-vrai.ts');
  const { allModules, valhallaOf } = await import('../src/valhalla/odin.ts');
  const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const od = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'thjalfi'].includes(m.id)) });
    const va = valhallaOf()!;
    const f = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: 'a1b2c3d4', name: 'Maison', maison: true, widgets: [{ id: 'b0000001', kind: 'bouton', w: 1, module: 'thjalfi', action: 'postes_vus', label: 'PC', input: {} }] }] }) });
    assert.equal(f.ok, true, f.text);
    const cle = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette entrée', droits: 'maison' })).data as { key: string }).key;
    const r = await od.json('/api/maison/fenetre', { id: 'b0000001' }, { cookie: '', 'x-odin-maison': cle });
    assert.notEqual(r.body.ok, true, JSON.stringify(r.body));
    assert.match(String(r.body.text), /propriétaire|bouton introuvable/); // depuis le lot 24c, un bouton réservé n'est même plus servi à la tablette
    assert.equal(r.body.data, undefined);
    const p = await od.json('/api/valhalla/act', { module: 'thjalfi', action: 'postes_vus', input: {} });
    assert.equal(p.body.ok, true, JSON.stringify(p.body).slice(0, 300));
  } finally { await tt.end(); Object.assign(console, orig); }
});
