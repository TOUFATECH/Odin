// Prónoia — corrections de la SECONDE relecture (carnets/relecture-pronoia-2.md). Chaque essai reprend le banc du
// relecteur : il échouait avant la correction et passe après. Le chemin des applis est le VRAI : un faux module dans un
// vrai Valhalla appelle `ctx.emit`, relayé à Prónoia par la greffe de service.ts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { pronoia, moteurPronoia, oublierMoteursPronoia } from '../src/valhalla/pronoia/index.ts';
import { noterDemandeOdin, oublierRelais } from '../src/valhalla/pronoia/branchement.ts';
import { demandesEquivalentes } from '../src/valhalla/pronoia/honnete.ts';
import { Pronoia } from '../src/valhalla/pronoia/moteur.ts';
import type { Module, ModCtx } from '../src/valhalla/types.ts';

const homes: string[] = [];
after(() => { oublierMoteursPronoia(); for (const h of homes) rmSync(h, { recursive: true, force: true }); });
const JOUR = 86_400_000, T0 = new Date(2026, 10, 2, 0, 0).getTime();
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pronoia + des faux modules émetteurs (ids réels des applis), sur un vrai Valhalla. */
function monter(emetteurs: string[]) {
  oublierRelais();
  const home = mkdtempSync(join(tmpdir(), 'pronoia-c2-')); homes.push(home);
  const h = { t: T0 };
  const mods: Module[] = emetteurs.map((id) => ({ id, name: `Émetteur ${id}`, family: 'Maison', what: 'essai', does: ['essai'], from: [], upstream: [], words: ['essai'], actions: [], view: () => ({ sections: [] }) }));
  const mod = pronoia(() => ({ maintenant: () => h.t }));
  const v = new Valhalla(home, [mod, ...mods], { notify: async () => {}, now: () => new Date(h.t) });
  mod.start?.(v.ctx('pronoia'));
  const emit = (appli: string, type: string, data: Record<string, unknown> = {}) => (v.ctx(appli) as ModCtx).emit(type, data);
  return { home, h, v, mod, emit, p: moteurPronoia(home)! };
}

test('constat 1 : une rafale d\'événements ne gèle pas Odin (file bornée, lots, une sauvegarde par lot)', async () => {
  const x = monter(['sindri']);
  const e = x.p.magasin.etat;
  for (let i = 0; i < 5000; i++) e.evenements.push({ appli: 'domus', type: `t${i % 40}`, at: T0 - i * 60_000, cle: `objet-${i % 300}` });
  for (let i = 0; i < 2000; i++) e.demandes.push({ at: T0 - i * 60_000, texte: `quelle est la météo à l'endroit numéro ${i} pour demain matin` });
  x.p.magasin.sauver();
  // Sonde de la boucle d'événements : le plus long retard d'une minuterie de 5 ms.
  let pire = 0, prevu = performance.now() + 5;
  const sonde = setInterval(() => { const n = performance.now(); pire = Math.max(pire, n - prevu); prevu = n + 5; }, 5);
  const tas0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) x.emit('sindri', 'sauvegarde_ok', { plan: 'nuit' });
  await attendre(4000);
  clearInterval(sonde);
  const tas = (process.memoryUsage().heapUsed - tas0) / 1048576;
  console.log(`# mesuré : plus long blocage de la boucle ${Math.round(pire)} ms ; tas +${tas.toFixed(1)} Mo ; gardés ${x.p.magasin.etat.evenements.filter((y) => y.appli === 'sindri').length}, laissés ${x.p.evenementsLaisses}`);
  assert.ok(pire < 300, `boucle bloquée ${Math.round(pire)} ms`);
  assert.ok(x.p.evenementsLaisses > 0, 'ce qui déborde de la file est laissé');
});

test('constat 2 : les types neutres qui suivent des personnes ne sont jamais appris ; liste blanche (appli, type)', async () => {
  const VRAIS: Array<[string, string, Record<string, unknown>]> = [
    ['himinbjorg', 'mouvement', { caméra: 'Entrée', part: 12, surveillé: true }], ['himinbjorg', 'clip', { caméra: 'Entrée' }],
    ['gjoll', 'vpn_connecte', { appareil: 'Téléphone de Marie' }], ['pegase', 'nouvel_appareil', { profil: 'Léa', appareil: 'tablette' }],
    ['var', 'connexion_refusee', { login: 'paul', ip: '192.0.2.4' }], ['var', 'nouvelle_adresse', { login: 'paul', ip: '192.0.2.5' }],
    ['frigg', 'reservation', { name: 'Mme Ali' }], ['volva', 'recherche', { question: 'pharmacie de garde' }],
    ['bragi', 'ordre', { texte: 'allume la lumière' }], ['venus', 'arrivee', { titre: 'film' }], ['appareils', 'etat', { appareil: 'porte' }],
  ];
  const x = monter([...new Set([...VRAIS.map((v) => v[0]), 'sindri'])]);
  for (let j = 0; j < 12; j++) {
    x.h.t = T0 + j * JOUR + 18 * 3_600_000 + (j % 3) * 60_000;
    for (const [a, t, d] of VRAIS) x.emit(a, t, d);
    x.emit('sindri', 'sauvegarde_ok', { plan: 'nuit' });
    await attendre(30);
  }
  await attendre(200);
  const gardes = x.p.magasin.etat.evenements.map((e) => `${e.appli}/${e.type}`);
  assert.deepEqual([...new Set(gardes)], ['sindri/sauvegarde_ok'], 'seul le couple de la liste blanche est appris');
  x.h.t = T0 + 12 * JOUR + 12 * 3_600_000;
  const p = x.p.prevoirEvenements().map((q) => q.prevision.cle);
  assert.ok(p.every((c) => c.startsWith('sindri/')), p.join(', '));
  // Ouvrir un couple : grave (accord du propriétaire), refusé à une automatisation, montré dans la page.
  const ouvrir = x.mod.actions.find((a) => a.id === 'ouvrir_source')!;
  assert.match(ouvrir.grave?.({ source: 'appareils/etat' }, x.v.ctx('pronoia')) ?? '', /apprendre/);
  assert.equal((await x.v.act('pronoia', 'ouvrir_source', { source: 'appareils/etat' }, { auto: true })).ok, false);
  assert.equal((await x.v.act('pronoia', 'ouvrir_source', { source: 'appareils/etat' })).ok, true);
  x.emit('appareils', 'etat', { appareil: 'porte du garage' });
  await attendre(100);
  assert.ok(x.p.magasin.etat.evenements.some((e) => e.appli === 'appareils'), 'une fois ouvert, le couple est appris');
  const page = JSON.stringify(await x.mod.view(x.v.ctx('pronoia'), new URLSearchParams()));
  assert.match(page, /Ce que Prónoia apprend/);
  assert.match(page, /appareils \/ etat/);
  assert.equal((await x.v.act('pronoia', 'fermer_source', { source: 'appareils/etat' }, { auto: true })).ok, true, 'fermer : un clic');
});

test('constat 3 : unités, devises, signe et ordre font des demandes différentes', () => {
  const differentes: Array<[string, string]> = [
    ['convertis 100 km en miles', 'convertis 100 m en miles'], ['combien font 3 h en minutes', 'combien font 3 j en minutes'],
    ['convertis 100 € en dollars', 'convertis 100 $ en dollars'], ['il fera -5 degrés ?', 'il fera 5 degrés ?'],
    ['taux de change USD EUR', 'taux de change EUR USD'], ['il y a 2 ou 3 colis ?', 'il y a 3 ou 2 colis ?'],
    ['température à Dax demain', 'température à Pau demain'], ['envoie 50 € à Ali', 'envoie 50 € à Léa'],
  ];
  for (const [a, b] of differentes) assert.equal(demandesEquivalentes(a, b), false, `${a} ⇄ ${b}`);
  for (const [a, b] of [['Convertis 100 euros en dollars ?', 'convertis 100 euros en dollars'], ['Quelle météo demain à Lyon', 'quelle météo demain à lyon !'], ['convertis 1 000 € en dollars', 'convertis 1000 € en dollars']]) assert.equal(demandesEquivalentes(a, b), true, `${a} ⇄ ${b}`);
});

test('constat 4 : fichier abîmé ou posé en clair → Prónoia coupée par prudence, alertée ; la coupure survit', () => {
  const home = mkdtempSync(join(tmpdir(), 'pronoia-c2-abime-')); homes.push(home);
  const p1 = new Pronoia({ home, maintenant: () => T0 });
  p1.couper();
  writeFileSync(p1.magasin.fichier, 'odc1:abime');
  const p2 = new Pronoia({ home, maintenant: () => T0 });
  assert.equal(p2.actif, false, 'la coupure du propriétaire survit (copie de secours)');
  assert.match(p2.magasin.illisible ?? '', /illisible/);
  // sans copie de secours : coupée quand même
  for (const f of readdirSync(dirname(p1.magasin.fichier))) rmSync(join(dirname(p1.magasin.fichier), f), { force: true });
  writeFileSync(p1.magasin.fichier, 'odc1:abime');
  const p3 = new Pronoia({ home, maintenant: () => T0 });
  assert.equal(p3.actif, false, 'illisible sans secours : coupée par prudence');
  // posé EN CLAIR : refusé
  for (const f of readdirSync(dirname(p1.magasin.fichier))) rmSync(join(dirname(p1.magasin.fichier), f), { force: true });
  writeFileSync(p1.magasin.fichier, JSON.stringify({ v: 1, reglages: { actif: true, gardeJours: 3650, seuilPressentiment: 0.3, seuilPrevenir: 0.5 }, demandes: [], evenements: [], previsions: [], prevenus: {}, mesures: {} }));
  const p4 = new Pronoia({ home, maintenant: () => T0 });
  assert.equal(p4.actif, false, 'un contenu non chiffré est refusé');
  assert.notEqual(p4.reglages.gardeJours, 3650);
  assert.match(p4.bilan().texte, /coupée par prudence/);
});

test('constat 5 : la greffe de la passerelle n\'écrit rien avant l\'envoi de la réponse', async () => {
  const x = monter([]);
  x.p.magasin.sauver();
  const avant = statSync(x.p.magasin.fichier).mtimeMs;
  const t0 = performance.now();
  noterDemandeOdin(x.home, 'quelle météo demain à Lyon', false);
  const ms = performance.now() - t0;
  assert.equal(x.p.magasin.etat.demandes.length, 0, 'rien dans le fil de la réponse');
  assert.equal(statSync(x.p.magasin.fichier).mtimeMs, avant, 'aucune écriture dans le fil de la réponse');
  assert.ok(ms < 5, `${ms.toFixed(2)} ms`);
  await attendre(50);
  assert.equal(x.p.magasin.etat.demandes.length, 1, 'notée après coup');
  await attendre(2500);
  assert.notEqual(statSync(x.p.magasin.fichier).mtimeMs, avant, 'puis sauvegardée (différée)');
});
