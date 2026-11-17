// Sûreté des automatisations, quatrième partie : une automatisation écrite par Odin, pas encore lancée avec l'accord du
// propriétaire et qui agit, ne part pas comme sous-automatisation d'une autre ; « ajouter un modèle » ne double pas un
// nom déjà pris (par l'outil comme par l'appli Talos).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reseauOdin } from '../src/draupnir/nodes.ts';
import { Talos } from '../src/draupnir/service.ts';
import { arreter, demarrer, reinitialiser, sonderMaintenant } from '../src/net/etat-internet.ts';
import { draupnirTool, setDraupnir } from '../src/tools/draupnir.ts';
import type { ToolContext } from '../src/tools/registry.ts';
import { coreModules, setValhalla } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { makeOdin } from './helpers.ts';

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

// La sous-automatisation qui agit (elle sort sur le réseau) et celle qui ne fait qu'un calcul.
const RAPPORT = { name: 'Rapport', nodes: [
  { name: 'Appelée', type: 'déclencheur.appel', params: {} },
  { name: 'Envoi', type: 'web.requête', params: { url: 'https://site.exemple/rapport', méthode: 'POST', corps: '{"a":1}' } },
], connections: { Appelée: [[{ node: 'Envoi' }]] } };
const CALCUL = { name: 'Calcul', nodes: [
  { name: 'Appelée', type: 'déclencheur.appel', params: {} },
  { name: 'Valeur', type: 'données.définir', params: {} },
], connections: { Appelée: [[{ node: 'Valeur' }]] } };
// L'automatisation du propriétaire, active, qui appelle une autre par son nom.
const appelante = (cible: string, declencheur = { name: 'Go', type: 'déclencheur.manuel', params: {} as Record<string, unknown> }, attendre = true) => ({
  name: `Appelle ${cible}`, active: true,
  nodes: [declencheur, { name: 'Lance', type: 'flux.exécuter', params: { automatisation: cible, attendre } }],
  connections: { [declencheur.name]: [[{ node: 'Lance' }]] },
});

function banc(o: { paths: { home: string; workspace: string } }) {
  const appels: string[] = [], messages: string[] = [];
  const f = (async (u: string) => { appels.push(String(u)); return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
  const d = new Talos(o.paths.home, { fetch: f, notify: async (t: string) => { messages.push(t); } }); setDraupnir(d);
  const ctx = (ecrit: unknown) => ({ sessionId: 's', channel: 'web', peer: 'p', workspace: o.paths.workspace, llm: async () => JSON.stringify(ecrit) } as unknown as ToolContext);
  return { d, appels, messages, ctx };
}

test('Talos : un nom libre appelé par une automatisation active du propriétaire, puis écrit par Odin → elle ne part pas sans accord ; le propriétaire est prévenu ; lancée une fois avec accord, elle part', async () => {
  const fin = await reseauDeclare();
  const o = makeOdin([]);
  const { d, appels, messages, ctx } = banc(o);
  try {
    const sienne = d.save(appelante('Rapport') as never);
    assert.match(String(await draupnirTool.run({ action: 'creer', description: 'un rapport' }, ctx(RAPPORT))), /créée/);
    const rapport = d.get('Rapport')!;
    const ex = await d.run(sienne.id, undefined, 'déclencheur', 'Go');
    assert.deepEqual(appels, [], 'rien n\'est sorti');
    assert.equal(d.runs(rapport.id).length, 0, 'la sous-automatisation n\'a pas tourné');
    assert.equal(ex.status, 'erreur');
    assert.match(ex.error ?? '', /attend ton accord : lance-la une fois toi-même/);
    assert.ok(messages.some((m) => /Rapport/.test(m) && /attend ton accord/.test(m)), `le propriétaire est prévenu (messages : ${JSON.stringify(messages)})`);
    // Le message nomme le geste qui valide (« Lancer » dans l'appli Talos, ou le demander à Odin), et dit que « Tester »
    // dans l'éditeur ne valide pas : un essai depuis l'éditeur laisse en effet la marque, l'appelante reste refusée.
    assert.match(ex.error ?? '', /« Lancer » dans l'appli Talos/);
    assert.match(ex.error ?? '', /demande à Odin/);
    assert.match(ex.error ?? '', /« Tester ».*ne la valide pas/);
    await d.run(rapport.id, undefined, 'test');
    appels.length = 0;
    const apresTest = await d.run(sienne.id, undefined, 'déclencheur', 'Go');
    assert.equal(apresTest.status, 'erreur', 'un essai depuis l\'éditeur ne valide pas');
    assert.deepEqual(appels, [], 'toujours rien de sorti par l\'appelante');
    // Sans attendre le résultat : elle ne part pas non plus, et le propriétaire est prévenu quand même.
    messages.length = 0;
    const sansAttendre = d.save({ ...appelante('Rapport', undefined, false), name: 'Sans attendre' } as never);
    await d.run(sansAttendre.id, undefined, 'déclencheur', 'Go');
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(appels, []);
    assert.ok(messages.some((m) => /attend ton accord/.test(m)), `prévenu aussi sans attendre (messages : ${JSON.stringify(messages)})`);
    // Le propriétaire la lance une fois (l'outil ne tourne qu'après son accord) : validée, elle part ensuite.
    await draupnirTool.run({ action: 'executer', id: 'Rapport' }, ctx(RAPPORT));
    appels.length = 0;
    const apres = await d.run(sienne.id, undefined, 'déclencheur', 'Go');
    assert.equal(apres.status, 'succès', apres.error);
    assert.equal(appels.length, 1, 'validée : elle part comme sous-automatisation');
  } finally { setDraupnir(undefined); d.stop(); o.cleanup(); fin(); }
});

test('Talos : une sous-automatisation du propriétaire, ou écrite par Odin sans rien qui agisse, part comme avant ; une automatisation active à l\'heure aussi', async () => {
  const fin = await reseauDeclare();
  const o = makeOdin([]);
  const { d, appels, messages, ctx } = banc(o);
  try {
    d.save({ ...RAPPORT, active: false } as never);
    const sienne = d.save(appelante('Rapport') as never);
    const ex = await d.run(sienne.id, undefined, 'déclencheur', 'Go');
    assert.equal(ex.status, 'succès', ex.error);
    assert.equal(appels.length, 1, 'celle du propriétaire part');
    // Écrite par Odin mais qui ne fait qu'un calcul : sans risque, elle part.
    assert.match(String(await draupnirTool.run({ action: 'creer', description: 'un calcul' }, ctx(CALCUL))), /créée/);
    const calcul = d.save(appelante('Calcul') as never);
    const exCalcul = await d.run(calcul.id, undefined, 'déclencheur', 'Go');
    assert.equal(exCalcul.status, 'succès', exCalcul.error);
    assert.equal(d.runs(d.get('Calcul')!.id).length, 1);
    // Active à l'heure (déclencheur « planning ») : passe comme avant et lance sa sous-automatisation.
    const heure = d.save({ ...appelante('Rapport', { name: 'Heure', type: 'déclencheur.planning', params: { mode: 'simple', rythme: 'chaque jour à 7h' } }), name: 'Le matin' } as never);
    const exHeure = await (d as unknown as { fire(id: string, n: string, it: unknown[]): Promise<{ status: string; error?: string }> }).fire(heure.id, 'Heure', [{ json: { heure: new Date().toISOString() } }]);
    assert.equal(exHeure.status, 'succès', exHeure.error);
    assert.equal(appels.length, 2);
    assert.deepEqual(messages, [], 'aucune alerte');
  } finally { setDraupnir(undefined); d.stop(); o.cleanup(); fin(); }
});

test('Talos : « ajouter un modèle » refuse un nom déjà pris, par l\'outil comme par l\'appli ; rien n\'est créé ni marqué', async () => {
  const fin = await reseauDeclare();
  const o = makeOdin([]);
  const { d, ctx } = banc(o);
  const v = new Valhalla(o.paths.home, coreModules(o)); setValhalla(v);
  try {
    // L'outil : un premier ajout passe, le second est refusé avec la raison.
    assert.match(String(await draupnirTool.run({ action: 'modele', id: 'flux-saga' }, ctx({}))), /ajouté/);
    const nom = d.list()[0].name;
    const deux = String(await draupnirTool.run({ action: 'modele', id: 'flux-saga' }, ctx({})));
    assert.match(deux, /déjà/, deux);
    assert.equal(d.list().length, 1, 'aucune copie par l\'outil');
    // L'appli : refusé aussi.
    const r = await v.act('draupnir', 'modele', { id: 'flux-saga' });
    assert.equal(r.ok, false, r.text);
    assert.match(r.text, /déjà/);
    assert.equal(d.list().length, 1, 'aucune copie par l\'appli');
    // Le nom pris par le propriétaire (casse et espaces autour différents) : refusé, et la sienne n'est pas marquée.
    d.trash(d.list()[0].id);
    const sienne = d.save({ ...RAPPORT, name: `  ${nom.toUpperCase()}  `, active: false } as never);
    assert.match(String(await draupnirTool.run({ action: 'modele', id: 'flux-saga' }, ctx({}))), /déjà/);
    assert.equal((await v.act('draupnir', 'modele', { id: 'flux-saga' })).ok, false);
    assert.equal(d.list().length, 1);
    assert.equal(draupnirTool.grave!({ action: 'executer', id: sienne.id }), undefined, 'la sienne n\'est pas marquée « écrite par Odin »');
  } finally { setValhalla(undefined); v.stop(); setDraupnir(undefined); d.stop(); o.cleanup(); fin(); }
});
