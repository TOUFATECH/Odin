// Talos, sûreté (troisième partie) :
// 1. Le détour par l'appli Talos : Odin ne lance pas non plus par l'action « Lancer » de l'appli (valhalla) une
//    automatisation qu'il vient d'écrire ; « Ajouter un modèle » de l'appli pose la marque « écrite par Odin ».
// 2. Les noms publics d'Odin refusés aux blocs web : aussi l'adresse du tunnel ouvert par Odin et le domaine sous lequel
//    Bifröst publie Odin, un domaine que le proxy Valgrind sert vers Odin et un nom Bifröst qui y mène ;
//    la liste est remise à vide quand Talos s'arrête.
// 3. « creer » ne double pas une automatisation existante : un nom déjà pris est refusé, avec la raison.
// Rien ne sort : les noms sont déclarés en remplaçant la résolution, les appels passent par un fetch d'essai.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFUS_VERS_ODIN, reseauOdin, versOdin } from '../src/draupnir/nodes.ts';
import { startDraupnir } from '../src/draupnir/odin.ts';
import { Talos } from '../src/draupnir/service.ts';
import { arreter, demarrer, reinitialiser, sonderMaintenant } from '../src/net/etat-internet.ts';
import { draupnirTool, setDraupnir } from '../src/tools/draupnir.ts';
import { valhallaTool } from '../src/tools/valhalla.ts';
import type { ToolContext } from '../src/tools/registry.ts';
import { bru } from '../src/valhalla/modules/bru.ts';
import { valgrind } from '../src/valhalla/modules/valgrind.ts';
import { coreModules, setValhalla } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { tunnel } from '../src/web/tunnel.ts';
import { call, makeOdin } from './helpers.ts';

const NOMS: Record<string, string[]> = { 'site.exemple': ['203.0.113.5'] };
async function reseauDeclare(): Promise<() => void> {
  const sauve = { ...reseauOdin };
  reseauOdin.resoudre = async (n) => { const r = NOMS[n]; if (!r) throw Object.assign(new Error('nom inconnu'), { code: 'ENOTFOUND' }); return r; };
  reseauOdin.adressesMachine = () => ['127.0.0.1', '::1'];
  reseauOdin.nomMachine = () => 'poste-odin';
  reseauOdin.nomsPublics = () => [];
  reinitialiser();
  demarrer({ sondes: { passerelle: async () => true, parNom: async () => true, parIp: async () => true }, intervalleMs: 1e9 });
  await sonderMaintenant();
  return () => { Object.assign(reseauOdin, sauve); arreter(); reinitialiser(); };
}

const ECRITE = JSON.stringify({ name: 'Relevé du site', nodes: [
  { name: 'Go', type: 'déclencheur.manuel', params: {} },
  { name: 'Appel', type: 'web.requête', params: { url: 'https://site.exemple/releve', méthode: 'POST', corps: '{"a":1}' } },
], connections: { Go: [[{ node: 'Appel' }]] } });

test('Talos : Odin crée puis lance par l\'appli Talos (valhalla) → l\'accord est demandé, avec ce que l\'automatisation fera', async () => {
  const fin = await reseauDeclare();
  const appels: string[] = [];
  const f = (async (u: string) => { appels.push(String(u)); return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
  const o = makeOdin([
    call('draupnir', { action: 'creer', description: 'relève le site' }),
    { text: ECRITE },
    call('valhalla', { action: 'action', appli: 'draupnir', quoi: 'executer', entree: JSON.stringify({ nom: 'Relevé du site' }) }),
    { text: 'fini' },
  ], { config: (c) => ({ ...c, mimir: { ...c.mimir, autonomy: 'breaker' } }) });
  const d = new Talos(o.paths.home, { fetch: f }); setDraupnir(d);
  const v = new Valhalla(o.paths.home, coreModules(o)); setValhalla(v);
  try {
    await o.agent.run('Crée une automatisation qui relève le site et lance-la', { sessionId: 's-detour' });
    const wf = d.get('Relevé du site');
    assert.ok(wf, 'l\'automatisation est créée');
    const demandes = o.approvals.filter((a) => /valhalla|applis/.test(a.summary));
    assert.equal(demandes.length, 1, `le lancement par l'appli demande l'accord (demandes : ${JSON.stringify(o.approvals.map((a) => a.summary))})`);
    assert.match(demandes[0].reason, /Relevé du site/);
    assert.match(demandes[0].reason, /site\.exemple/, 'la demande dit où elle sort');
    assert.deepEqual(appels, [], 'refusée : rien n\'est parti');
    assert.equal(d.runs(wf.id).length, 0, 'refusée : rien n\'a été lancé');
    // Depuis une automatisation (sans personne), l'appli refuse ce lancement.
    const auto = await v.act('draupnir', 'executer', { nom: 'Relevé du site' }, { auto: true });
    assert.equal(auto.ok, false); assert.equal(d.runs(wf.id).length, 0);
  } finally { setValhalla(undefined); v.stop(); setDraupnir(undefined); d.stop(); o.cleanup(); fin(); }
});

test('Talos : « Ajouter un modèle » de l\'appli pose la marque ; celle du propriétaire se lance comme avant ; lancée avec accord, validée', async () => {
  const fin = await reseauDeclare();
  const o = makeOdin([]);
  const d = new Talos(o.paths.home, { fetch: (async () => new Response('{}')) as unknown as typeof fetch }); setDraupnir(d);
  const v = new Valhalla(o.paths.home, coreModules(o)); setValhalla(v);
  const graveAppli = (nom: string) => valhallaTool.grave!({ action: 'action', appli: 'draupnir', quoi: 'executer', entree: JSON.stringify({ nom }) });
  try {
    const r = await v.act('draupnir', 'modele', { id: 'flux-saga' });
    assert.notEqual(r.ok, false, r.text);
    const modele = d.list().find((w) => w.name === 'Flux vers Thot')!;
    assert.ok(draupnirTool.grave!({ action: 'executer', id: modele.id }), 'le geste de l\'outil demande l\'accord');
    assert.match(graveAppli('Flux vers Thot') ?? '', /Flux vers Thot/, 'l\'action de l\'appli aussi');
    // L'automatisation du propriétaire (écrite dans la page Talos) : rien ne change.
    d.save({ name: 'La sienne', active: false, nodes: JSON.parse(ECRITE).nodes, connections: JSON.parse(ECRITE).connections });
    assert.equal(graveAppli('La sienne'), undefined);
    // Lancée par l'appli avec son accord (la page confirme, Heimdall a dit oui) : validée, plus de demande.
    const lance = await v.act('draupnir', 'executer', { nom: 'Flux vers Thot' });
    assert.notEqual(lance.ok, false, lance.text);
    assert.equal(graveAppli('Flux vers Thot'), undefined);
  } finally { setValhalla(undefined); v.stop(); setDraupnir(undefined); d.stop(); o.cleanup(); fin(); }
});

test('Talos : l\'adresse du tunnel et le domaine publié par Bifröst sont refusés aux blocs web ; la liste est vidée à l\'arrêt', async () => {
  const fin = await reseauDeclare();
  const o = makeOdin([], { config: (c) => ({ ...c, web: { ...c.web, publicUrl: 'https://odin.reglee.exemple' } }) });
  const v = new Valhalla(o.paths.home, [bru]); setValhalla(v);
  const avant = { ...tunnel.state };
  const port = o.cfg.web.port;
  v.ctx('bru').saveSettings({ odinHost: 'odin.maison.exemple', published: [
    { hostname: 'boite.maison.exemple', service: `https://localhost:${port}`, zone: 'maison.exemple', zoneId: 'z', at: 0 },
    { hostname: 'nas.maison.exemple', service: 'http://192.168.1.10:8080', zone: 'maison.exemple', zoneId: 'z', at: 0 },
  ] });
  const arreterTalos = startDraupnir(o, async () => {});
  try {
    tunnel.state = { kind: 'cloudflare', running: true, url: 'https://deux-mots-essai.trycloudflare.com/' };
    for (const u of ['https://deux-mots-essai.trycloudflare.com/api/state', 'https://DEUX-mots-essai.trycloudflare.com.:443/', 'https://odin.maison.exemple/api/state', 'https://boite.maison.exemple/']) {
      assert.equal(await versOdin(u), REFUS_VERS_ODIN, u);
    }
    tunnel.state = { kind: 'tailscale', running: true, url: 'https://poste.reseau-essai.ts.net/' };
    assert.equal(await versOdin('https://poste.reseau-essai.ts.net/'), REFUS_VERS_ODIN, 'nom Tailscale');
    // Un autre nom publié (une autre machine) et un site : permis comme avant.
    assert.equal(await versOdin('http://nas.maison.exemple/'), undefined);
    assert.equal(await versOdin('https://site.exemple/'), undefined);
    assert.equal(await versOdin('https://odin.reglee.exemple/'), REFUS_VERS_ODIN, 'l\'adresse réglée, comme avant');
  } finally { arreterTalos(); tunnel.state = avant; setValhalla(undefined); v.stop(); }
  try {
    assert.deepEqual(reseauOdin.nomsPublics(), [], 'Talos arrêté : plus aucun nom gardé');
  } finally { o.cleanup(); fin(); }
});

test('Talos : « creer » refuse un nom déjà pris, avec la raison ; l\'automatisation existante reste la même', async () => {
  const fin = await reseauDeclare();
  const o = makeOdin([]);
  const d = new Talos(o.paths.home, { fetch: (async () => new Response('{}')) as unknown as typeof fetch }); setDraupnir(d);
  const ctx = { sessionId: 's', channel: 'web', peer: 'p', workspace: o.paths.workspace, llm: async () => ECRITE } as unknown as ToolContext;
  try {
    const sienne = d.save({ name: 'relevé DU site', active: true, nodes: [{ id: '', name: 'Go', type: 'déclencheur.manuel', params: {} }], connections: {} });
    const sortie = String(await draupnirTool.run({ action: 'creer', description: 'relevé' }, ctx));
    assert.match(sortie, /déjà/, sortie);
    assert.match(sortie, /relevé DU site/i);
    assert.equal(d.list().length, 1, 'aucune copie');
    assert.deepEqual(d.get('Relevé du site'), sienne, 'le nom mène toujours à celle du propriétaire');
    assert.equal(draupnirTool.grave!({ action: 'executer', id: sienne.id }), undefined, 'et elle n\'est pas marquée « écrite par Odin »');
    // Un nom libre : créée comme avant.
    d.save({ ...sienne, name: 'Autre nom' });
    assert.match(String(await draupnirTool.run({ action: 'creer', description: 'relevé' }, ctx)), /créée/);
    assert.equal(d.list().length, 2);
  } finally { setDraupnir(undefined); d.stop(); o.cleanup(); fin(); }
});

test('Talos : un domaine que le proxy Valgrind sert vers Odin, et un nom Bifröst qui y mène (par Valgrind ou vers 0.0.0.0), sont refusés aux blocs web', async () => {
  const fin = await reseauDeclare();
  reseauOdin.adressesMachine = () => ['127.0.0.1', '::1', '192.0.2.7'];
  const o = makeOdin([]);
  const v = new Valhalla(o.paths.home, [bru, valgrind]); setValhalla(v);
  const port = o.cfg.web.port;
  v.ctx('valgrind').saveSettings({ hosts: [
    { id: 'a', domains: ['odin.proxy.exemple'], target: `http://127.0.0.1:${port}`, enabled: true },
    { id: 'b', domains: ['*.applis.exemple'], target: `https://[::1]:${port}`, enabled: true },
    { id: 'c', domains: ['poste.proxy.exemple'], target: `http://192.0.2.7:${port}`, enabled: true },
    { id: 'd', domains: ['nas.proxy.exemple'], target: 'http://192.168.1.10:8080', enabled: true },
  ] });
  v.ctx('bru').saveSettings({ published: [
    { hostname: 'zero.maison.exemple', service: `https://0.0.0.0:${port}`, zone: 'maison.exemple', zoneId: 'z', at: 0 },
    { hostname: 'boite.applis.exemple', service: 'https://localhost:443', zone: 'applis.exemple', zoneId: 'z', at: 0 },
    { hostname: 'nas.proxy.exemple', service: 'https://localhost:443', zone: 'proxy.exemple', zoneId: 'z', at: 0 },
    { hostname: 'autre.maison.exemple', service: 'https://localhost:443', zone: 'maison.exemple', zoneId: 'z', at: 0 },
  ] });
  const arreterTalos = startDraupnir(o, async () => {});
  try {
    for (const u of ['https://odin.proxy.exemple/api/state', 'https://poste.proxy.exemple/', 'https://zero.maison.exemple/', 'https://boite.applis.exemple/api/state']) {
      assert.equal(await versOdin(u), REFUS_VERS_ODIN, u);
    }
    // Un site du proxy vers une autre machine, et un nom publié vers le proxy qui ne mène pas à Odin : permis comme avant.
    for (const u of ['https://nas.proxy.exemple/', 'https://autre.maison.exemple/']) assert.equal(await versOdin(u), undefined, u);
  } finally { arreterTalos(); setValhalla(undefined); v.stop(); o.cleanup(); fin(); }
});
