// Talos, sûreté (suite) :
// 1. Odin ne lance pas sans l'accord du propriétaire une automatisation qu'il vient d'écrire lui-même : la demande
//    d'accord dit ce que ses blocs vont faire. Une automatisation écrite par le propriétaire, ou déjà validée par lui,
//    se lance comme avant ; une automatisation qui ne fait rien d'engageant aussi.
// 2. Les déclencheurs « flux » et « surveiller une page » n'appellent jamais Odin lui-même (même contrôle que les blocs web).
// Rien ne sort : les noms sont déclarés en remplaçant la résolution, les appels passent par un fetch d'essai.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reseauOdin } from '../src/draupnir/nodes.ts';
import { Talos } from '../src/draupnir/service.ts';
import { arreter, demarrer, reinitialiser, sonderMaintenant } from '../src/net/etat-internet.ts';
import { draupnirTool, setDraupnir } from '../src/tools/draupnir.ts';
import type { ToolContext } from '../src/tools/registry.ts';
import { call, makeOdin } from './helpers.ts';

const REFUS = /n'appelle pas Odin lui-même/;
const NOMS: Record<string, string[]> = { 'site.exemple': ['203.0.113.5'], 'odin-alias.maison': ['127.0.0.1'], 'machine-lan.maison': ['192.168.77.10'] };

async function reseauDeclare(): Promise<() => void> {
  const sauve = { ...reseauOdin };
  reseauOdin.resoudre = async (n) => { const r = NOMS[n]; if (!r) throw Object.assign(new Error('nom inconnu'), { code: 'ENOTFOUND' }); return r; };
  reseauOdin.adressesMachine = () => ['127.0.0.1', '::1', '192.168.77.10'];
  reseauOdin.nomMachine = () => 'poste-odin';
  reseauOdin.nomsPublics = () => [];
  reinitialiser();
  demarrer({ sondes: { passerelle: async () => true, parNom: async () => true, parIp: async () => true }, intervalleMs: 1e9 });
  await sonderMaintenant();
  return () => { Object.assign(reseauOdin, sauve); arreter(); reinitialiser(); };
}

// Ce que l'IA rend quand on lui demande d'écrire l'automatisation.
const ECRITE = JSON.stringify({ name: 'Relevé du site', nodes: [
  { name: 'Go', type: 'déclencheur.manuel', params: {} },
  { name: 'Appel', type: 'web.requête', params: { url: 'https://site.exemple/releve', méthode: 'POST', corps: '{"a":1}' } },
  { name: 'Note', type: 'saga.écrire', params: { mode: 'créer', titre: 'Relevé', contenu: '{{ $json }}' } },
], connections: { Go: [[{ node: 'Appel' }]], Appel: [[{ node: 'Note' }]] } });
const SANS_RISQUE = JSON.stringify({ name: 'Calcul', nodes: [
  { name: 'Go', type: 'déclencheur.manuel', params: {} },
  { name: 'Champs', type: 'données.définir', params: { champs: { a: 1 } } },
], connections: { Go: [[{ node: 'Champs' }]] } });

test('Talos : Odin crée puis lance une automatisation qui sort sur le réseau → l\'accord du propriétaire est demandé, avec ce qu\'elle fera', async () => {
  const fin = await reseauDeclare();
  const appels: string[] = [];
  const f = (async (u: string) => { appels.push(String(u)); return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
  const o = makeOdin([
    call('draupnir', { action: 'creer', description: 'relève le site et range-le dans Thot' }),
    { text: ECRITE },
    call('draupnir', { action: 'executer', id: 'Relevé du site' }),
    { text: 'fini' },
  // Odin Breaker : aujourd'hui, plus aucune question pour un geste « exec » (comme le mode autonome, ou une autorisation
  // permanente, avec le juge) ; seule une raison « grave » fait encore demander l'accord.
  ], { config: (c) => ({ ...c, mimir: { ...c.mimir, autonomy: 'breaker' } }) });
  const d = new Talos(o.paths.home, { fetch: f }); setDraupnir(d);
  try {
    await o.agent.run('Crée une automatisation qui relève le site et lance-la', { sessionId: 's-releve' });
    const wf = d.get('Relevé du site');
    assert.ok(wf, 'l\'automatisation est créée');
    const demandes = o.approvals.filter((a) => /automatisation executer/.test(a.summary));
    assert.equal(demandes.length, 1, `le lancement demande l'accord (demandes : ${JSON.stringify(o.approvals.map((a) => a.summary))})`);
    assert.match(demandes[0].reason, /Relevé du site/);
    assert.match(demandes[0].reason, /site\.exemple/, 'la demande dit où elle sort');
    assert.match(demandes[0].reason, /Thot/, 'la demande dit qu\'elle écrit dans Thot');
    assert.deepEqual(appels, [], 'refusée : rien n\'est parti');
    assert.equal(d.runs(wf.id).length, 0, 'refusée : rien n\'a été lancé');
  } finally { setDraupnir(undefined); d.stop(); o.cleanup(); fin(); }
});

test('Talos : écrite par le propriétaire, déjà validée, ou sans rien d\'engageant → lancée comme avant ; activer reste grave', async () => {
  const fin = await reseauDeclare();
  const o = makeOdin([]);
  const d = new Talos(o.paths.home, { fetch: (async () => new Response('{}')) as unknown as typeof fetch }); setDraupnir(d);
  let reponse = ECRITE;
  const ctx = { sessionId: 's', channel: 'web', peer: 'p', workspace: o.paths.workspace, llm: async () => reponse } as unknown as ToolContext;
  const grave = (id: string, action = 'executer') => draupnirTool.grave!({ action, id });
  try {
    // Écrite par le propriétaire (page Talos) : rien ne change.
    const sienne = d.save({ name: 'La sienne', active: false, nodes: JSON.parse(ECRITE).nodes, connections: JSON.parse(ECRITE).connections });
    assert.equal(grave(sienne.id), undefined);
    assert.equal(grave('La sienne'), undefined);

    // Écrite par Odin : l'accord est demandé, par son nom comme par son identifiant.
    await draupnirTool.run({ action: 'creer', description: 'relevé' }, ctx);
    const ecrite = d.list().find((w) => w.name === 'Relevé du site')!;
    assert.match(grave(ecrite.id) ?? '', /Appel.*site\.exemple/);
    assert.match(grave('relevé du site') ?? '', /Note.*Thot/);
    // Une fois lancée avec son accord (l'outil ne tourne qu'après la décision), elle est validée : plus de demande.
    const sortie = String(await draupnirTool.run({ action: 'executer', id: ecrite.id }, ctx));
    assert.match(sortie, /Relevé du site/);
    assert.equal(grave(ecrite.id), undefined);

    // Une automatisation sans rien d'engageant (des calculs) : Odin la lance seul, comme avant.
    reponse = SANS_RISQUE;
    await draupnirTool.run({ action: 'creer', description: 'calcul' }, ctx);
    assert.equal(grave('Calcul'), undefined);

    // Un modèle ajouté par Odin qui agit (il écrit dans Thot, prévient) : l'accord est demandé aussi.
    await draupnirTool.run({ action: 'modele', id: 'flux-saga' }, ctx);
    const modele = d.list().find((w) => w.name === 'Flux vers Thot')!;
    assert.ok(grave(modele.id));

    // Les autres gestes ne changent pas : activer reste grave, voir et lister restent libres.
    assert.ok(grave(sienne.id, 'activer'));
    assert.equal(grave(ecrite.id, 'voir'), undefined);
  } finally { setDraupnir(undefined); d.stop(); o.cleanup(); fin(); }
});

test('Talos : les déclencheurs « flux » et « surveiller une page » n\'appellent pas Odin lui-même, ni par une redirection', async () => {
  const fin = await reseauDeclare();
  const appels: string[] = [];
  const f = (async (u: string) => {
    appels.push(String(u));
    const x = new URL(String(u));
    if (x.pathname === '/vers-odin') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8888/api/state' } });
    if (x.pathname === '/vers-ailleurs') return new Response(null, { status: 302, headers: { location: '/flux' } });
    return new Response('<rss><channel><item><title>Un</title><link>https://b/1</link><guid>1</guid></item></channel></rss>');
  }) as unknown as typeof fetch;
  const o = makeOdin([]);
  const d = new Talos(o.paths.home, { fetch: f });
  const declencheur = (type: string, url: string) => d.save({ name: `${type} ${url}`, active: false, nodes: [
    { id: '', name: 'Quand', type, params: { url } },
    { id: '', name: 'Champs', type: 'données.définir', params: {} },
  ], connections: { Quand: [[{ node: 'Champs' }]] } });
  try {
    for (const type of ['déclencheur.flux', 'déclencheur.surveille']) {
      for (const url of ['http://127.0.0.1:8888/api/state', 'http://localhost:8888/', 'http://odin-alias.maison/', 'http://machine-lan.maison:9000/', 'http://[::1]/', 'http://poste-odin/']) {
        appels.length = 0;
        const wf = declencheur(type, url);
        await assert.rejects(d.poll(wf.id, 'Quand'), REFUS, `${type} ${url}`);
        assert.deepEqual(appels, [], `${type} ${url} : rien n'est parti`);
      }
      appels.length = 0;
      const saut = declencheur(type, 'https://site.exemple/vers-odin');
      await assert.rejects(d.poll(saut.id, 'Quand'), REFUS, `${type} : redirection vers Odin`);
      assert.deepEqual(appels, ['https://site.exemple/vers-odin'], 'seul le site a été appelé');
      // Permis comme avant : un site, et une redirection vers le même site.
      appels.length = 0;
      const site = declencheur(type, 'https://site.exemple/vers-ailleurs');
      assert.equal(await d.poll(site.id, 'Quand'), 0, 'première lecture : référence');
      assert.deepEqual(appels, ['https://site.exemple/vers-ailleurs', 'https://site.exemple/flux']);
    }
  } finally { d.stop(); o.cleanup(); fin(); }
});

test('Talos : la marque « écrite par Odin » tient après un redémarrage d\'Odin ; une fois validée, elle le reste aussi', async () => {
  const fin = await reseauDeclare();
  const o = makeOdin([]);
  const f = (async () => new Response('{}')) as unknown as typeof fetch;
  const d = new Talos(o.paths.home, { fetch: f }); setDraupnir(d);
  const ctx = { sessionId: 's', channel: 'web', peer: 'p', workspace: o.paths.workspace, llm: async () => ECRITE } as unknown as ToolContext;
  // Un Odin redémarré : l'outil est rechargé à neuf (rien de ce qu'il gardait en mémoire), Talos relit son dossier.
  const redemarrer = async (n: number) => {
    const m = await import(new URL(`../src/tools/draupnir.ts?redemarrage=${n}`, import.meta.url).href) as typeof import('../src/tools/draupnir.ts');
    const t = new Talos(o.paths.home, { fetch: f }); m.setDraupnir(t);
    return { m, t, grave: (id: string) => m.draupnirTool.grave!({ action: 'executer', id }) };
  };
  const ouverts: Talos[] = [];
  try {
    await draupnirTool.run({ action: 'creer', description: 'relevé' }, ctx);
    const ecrite = d.list().find((w) => w.name === 'Relevé du site')!;
    setDraupnir(undefined); d.stop();
    const r1 = await redemarrer(1); ouverts.push(r1.t);
    assert.match(r1.grave(ecrite.id) ?? '', /Appel.*site\.exemple/, 'après le redémarrage, l\'accord est toujours demandé');
    // Lancée avec son accord : validée, et toujours validée après un nouveau redémarrage.
    await r1.m.draupnirTool.run({ action: 'executer', id: ecrite.id }, ctx);
    assert.equal(r1.grave(ecrite.id), undefined);
    r1.m.setDraupnir(undefined); r1.t.stop();
    const r2 = await redemarrer(2); ouverts.push(r2.t);
    assert.equal(r2.grave(ecrite.id), undefined, 'validée une fois : plus de demande, même après un redémarrage');
    r2.m.setDraupnir(undefined);
  } finally { setDraupnir(undefined); d.stop(); for (const t of ouverts) t.stop(); o.cleanup(); fin(); }
});
