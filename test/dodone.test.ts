// Dodone : variables, coffre (jamais en clair, jamais affiché, jamais exporté), tests sur la réponse, import Postman
// v2.1 (dossiers, bearer, script signalé non exécuté), import OpenAPI JSON et YAML, collection lancée en séquence et
// plafonnée, tâche Talos par collection programmée, alerte sur test échoué, lien refusé. Faux serveur local.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { cheminJson, lireTests, substituer, variablesDe } from '../src/valhalla/dodone/collections.ts';
import { envoyer, evaluer } from '../src/valhalla/dodone/envoi.ts';
import { exporterPostman, importerOpenApi, importerPostman, parametresSecretsLien } from '../src/valhalla/dodone/import.ts';
import { boucleLocale, PORTS_ODIN, versOdinLuiMeme } from '../src/valhalla/boucle.ts';
import { MAX_COLLECTION, reseauDodone } from '../src/valhalla/modules/dodone.ts';

const SECRET = 'jeton-ultra-secret-42';
let recus = 0, cleRecue = '';
const srv = createServer((req, res) => {
  recus++;
  const u = new URL(req.url!, 'http://x');
  if (u.searchParams.has('api_key')) cleRecue = u.searchParams.get('api_key')!;
  if (u.pathname === '/echo') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ auth: req.headers.authorization ?? null, data: { id: 7, noms: ['a', 'b'] } })); return; }
  if (u.pathname === '/lent') { setTimeout(() => { res.end('{}'); }, 120); return; }
  res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"erreur":"absent"}');
});
let base = '';
const local: typeof fetch = (u, i) => fetch(String(u).replace('http://api.exemple.test', base), i);
const home = mkdtempSync(join(tmpdir(), 'dodone-'));
after(() => { srv.close(); reseauDodone(); rmSync(home, { recursive: true, force: true }); });

const POSTMAN = {
  info: { name: 'Mon service', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: 'clair-dans-la-collection', type: 'string' }] },
  event: [{ listen: 'prerequest', script: { exec: ['pm.environment.set("x", 1)'] } }],
  item: [
    { name: 'Utilisateurs', item: [{ name: 'Liste', request: { method: 'GET', url: { raw: '{{base}}/echo' }, header: [{ key: 'Accept', value: 'application/json' }] }, event: [{ listen: 'test', script: { exec: ['pm.test("ok", () => {})'] } }] }] },
    { name: 'Créer', request: { method: 'POST', url: '{{base}}/echo', body: { mode: 'raw', raw: '{"a":1}' }, auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{JETON}}' }] } } },
  ],
};
const OPENAPI_YAML = `openapi: 3.0.3
info:
  title: Animaux
servers:
  - url: http://api.exemple.test
paths:
  /animaux/{id}:
    get:
      operationId: lireAnimal
      tags: [animaux]
  /animaux:
    post:
      summary: Ajouter
      requestBody:
        content:
          application/json:
            example: {nom: Rex}
`;

test('variables, chemins JSON, tests, import et export (pur)', async () => {
  assert.equal(substituer('{{a}}/x/{{ b }}/{{inconnue}}', { a: '1', b: '2' }), '1/x/2/{{inconnue}}');
  assert.equal(substituer('Basic {{@base64 moi:{{P}}}}', { P: 'pw' }), `Basic ${Buffer.from('moi:pw').toString('base64')}`);
  assert.deepEqual(cheminJson({ a: { b: [{ c: 3 }] } }, 'a.b[0].c'), { existe: true, valeur: 3 });
  assert.equal(cheminJson({ a: 1 }, 'a.x').existe, false);
  const t = lireTests('code = 200\ntemps < 1000\njson data.id existe\njson data.id = 7\njson data.noms contient b\njson rien existe');
  const r = evaluer(t, { code: 200, ms: 12, entetes: {}, corps: '{"data":{"id":7,"noms":["a","b"]}}', taille: 10, tronque: false });
  assert.deepEqual(r.map((x) => x.ok), [true, true, true, true, true, false]);
  assert.throws(() => lireTests('n\'importe quoi'));
  const p = importerPostman(POSTMAN);
  assert.equal(p.collection!.requetes.length, 2); assert.equal(p.collection!.requetes[0].dossier, 'Utilisateurs');
  assert.ok(p.collection!.requetes[0].entetes.some((h) => h.nom === 'Authorization' && /^Bearer \{\{/.test(h.valeur)), 'bearer de la collection hérité, en variable');
  assert.ok(p.collection!.requetes[1].entetes.some((h) => h.valeur === 'Bearer {{JETON}}'));
  assert.deepEqual(Object.values(p.secrets), ['clair-dans-la-collection'], 'la valeur en clair part au coffre');
  assert.doesNotMatch(JSON.stringify(p.collection), /clair-dans-la-collection/);
  assert.equal(p.signalements.filter((x) => /NON exécuté/.test(x)).length, 2);
  for (const o of [importerOpenApi(OPENAPI_YAML), importerOpenApi(JSON.stringify({ openapi: '3.1.0', info: { title: 'Animaux' }, servers: [{ url: 'http://api.exemple.test' }], paths: { '/animaux/{id}': { get: { operationId: 'lireAnimal' } }, '/animaux': { post: { summary: 'Ajouter', requestBody: { content: { 'application/json': { example: { nom: 'Rex' } } } } } } } }))]) {
    const c = o.collection!;
    assert.equal(c.nom, 'Animaux'); assert.equal(c.variables.baseUrl, 'http://api.exemple.test');
    assert.deepEqual(c.requetes.map((x) => `${x.methode} ${x.url}`).sort(), ['GET {{baseUrl}}/animaux/{{id}}', 'POST {{baseUrl}}/animaux']);
    assert.match(c.requetes.find((x) => x.methode === 'POST')!.corps!, /Rex/);
  }
  const ex = exporterPostman({ ...p.collection!, requetes: [...p.collection!.requetes, { id: 'z', nom: 'clair', methode: 'GET', url: `http://a.test/?k=${SECRET}`, entetes: [{ nom: 'X-Api-Key', valeur: SECRET }], tests: [] }] }, { JETON: SECRET });
  assert.doesNotMatch(ex, new RegExp(SECRET)); assert.match(ex, /v2\.1\.0/);
  await assert.rejects(envoyer(local, { methode: 'GET', url: 'http://169.254.169.254/latest/meta-data', entetes: {} }), /réservée|refus/);
  await assert.rejects(envoyer(local, { methode: 'GET', url: 'http://moi:pw@api.exemple.test/', entetes: {} }), /identifiant/);
});

test('import : variable secrète de collection gardée sous son nom, clé du lien et mot de passe du corps au coffre', () => {
  const p = importerPostman({
    info: { name: 'Clés' }, variable: [{ key: 'api_key', value: 'VARSECRETE987' }, { key: 'base', value: 'https://api.ex.com' }],
    item: [
      { name: 'par variable', request: { method: 'GET', url: '{{base}}/x?api_key={{api_key}}' } },
      { name: 'en clair', request: { method: 'POST', url: 'https://api.ex.com/x?page=2&api_key=SEKRETabc123#haut', body: { mode: 'raw', raw: '{"user":"bob","password":"MotDePasse!77"}' } } },
    ],
  });
  const c = p.collection!;
  // La variable garde son nom : la substitution ne laisse aucune variable manquante.
  assert.equal(p.secrets.api_key, 'VARSECRETE987');
  const url0 = substituer(c.requetes[0].url, { ...c.variables, ...p.secrets });
  assert.equal(url0, 'https://api.ex.com/x?api_key=VARSECRETE987'); assert.deepEqual(variablesDe(url0), []);
  // La clé écrite en clair dans le lien et le mot de passe du corps partent au coffre, sans prendre le nom de la variable.
  assert.equal(c.requetes[1].url, 'https://api.ex.com/x?page=2&api_key={{API_KEY}}#haut');
  assert.equal(p.secrets.API_KEY, 'SEKRETabc123');
  assert.match(c.requetes[1].corps!, /"password":"\{\{PASSWORD\}\}"/); assert.equal(p.secrets.PASSWORD, 'MotDePasse!77');
  assert.doesNotMatch(JSON.stringify(c), /VARSECRETE987|SEKRETabc123|MotDePasse/);
  assert.equal(substituer(c.requetes[1].url, { ...c.variables, ...p.secrets }), 'https://api.ex.com/x?page=2&api_key=SEKRETabc123#haut', 'l\'envoi refait le même lien');
  // Export d'une requête ancienne restée en clair : le paramètre part en {{NOM}}.
  const ex = exporterPostman({ ...c, requetes: [{ id: 'v', nom: 'vieille', methode: 'GET', url: 'http://a.test/?token=CLAIRANCIEN1', entetes: [], corps: 'login=bob&password=CLAIRANCIEN2', tests: [] }] });
  assert.doesNotMatch(ex, /CLAIRANCIEN/); assert.match(ex, /token=\{\{TOKEN\}\}/);
  // Paramètres : seulement après le « ? », jamais une valeur vide ni une {{variable}}.
  assert.equal(parametresSecretsLien('http://a.test/token=1/x?a=1&secret=&key={{K}}', () => 'X'), 'http://a.test/token=1/x?a=1&secret=&key={{K}}');
});

test('base64 : variable manquante jamais encodée en douce, mot de passe avec « } » encodé en entier', () => {
  const b64 = (x: string) => Buffer.from(x, 'utf8').toString('base64');
  const manque = substituer('Basic {{@base64 bob:{{MOT}}}}', {});
  assert.equal(manque, 'Basic {{@base64 bob:{{MOT}}}}'); assert.deepEqual(variablesDe(manque), ['MOT']);
  assert.equal(substituer('Basic {{@base64 bob:{{MOT}}}}', { MOT: 'a}b' }), `Basic ${b64('bob:a}b')}`);
  assert.equal(substituer('Basic {{@base64 bob:{{MOT}}}}', { MOT: 'hunter22' }), `Basic ${b64('bob:hunter22')}`);
});

test('boucle locale : un service sur cette machine est permis, jamais les ports d\'Odin', async () => {
  const machine = new Set(['192.168.1.147']);
  assert.equal(versOdinLuiMeme(['127.0.0.1'], 3000, machine), false);
  assert.equal(versOdinLuiMeme(['localhost'], 8888, machine), true);
  assert.equal(versOdinLuiMeme(['192.168.1.147'], 8888, machine), true, 'la même machine par son adresse du réseau : même règle');
  assert.equal(versOdinLuiMeme(['192.168.1.147'], 3000, machine), false);
  assert.equal(versOdinLuiMeme(['192.168.1.20'], 8888, machine), false, 'une autre machine de la maison');
  assert.ok(PORTS_ODIN.has(8888) && PORTS_ODIN.has(8890));
  assert.equal(boucleLocale('::ffff:127.0.0.1'), true); assert.equal(boucleLocale('0.0.0.0'), false);
  await assert.rejects(envoyer(local, { methode: 'GET', url: 'http://127.0.0.1:8888/', entetes: {} }, { machine }), /interface d'Odin/);
  await assert.rejects(envoyer(local, { methode: 'GET', url: 'http://192.168.1.147:8888/', entetes: {} }, { machine, resoudre: async () => [] }), /interface d'Odin/);
  await assert.rejects(envoyer(local, { methode: 'GET', url: 'http://0.0.0.0:3000/', entetes: {} }, { machine }), /réservée/);
});

test('dans Odin : coffre, envoi, historique masqué, collection séquentielle, Talos, alerte', async () => {
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening'); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  reseauDodone({ resoudre: async (h) => (h === 'api.exemple.test' ? ['203.0.113.20'] : h === 'piege.test' ? ['127.0.0.1'] : []) });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { notify: async () => {}, autonomy: () => 'equilibre', fetch: local } as never);
  const m = v.modules().find((x) => x.id === 'dodone')!, ctx = v.ctx('dodone'), evts: string[] = [];
  v.events.on('event', (e: { module: string; type: string }) => { if (e.module === 'dodone') evts.push(e.type); });
  try {
    assert.equal(m.actions.find((a) => a.id === 'secret')!.params!.find((p) => p.key === 'valeur')!.kind, 'password');
    assert.equal((await v.act('dodone', 'environnement', { nom: 'maison', variables: 'base=http://api.exemple.test' })).ok, true);
    assert.equal((await v.act('dodone', 'environnement', { nom: 'maison', variables: 'api_token=fuite' })).ok, false, 'un secret ne va pas dans les variables');
    assert.equal((await v.act('dodone', 'secret', { environnement: 'maison', nom: 'JETON', valeur: SECRET })).ok, true);
    const coffre = readFileSync(join(ctx.dir, 'coffre.json'), 'utf8');
    assert.doesNotMatch(coffre, new RegExp(SECRET)); for (const val of Object.values(JSON.parse(coffre) as Record<string, Record<string, string>>).flatMap((x) => Object.values(x))) assert.match(val, /^odc1:/);
    // Envoi : le serveur renvoie le jeton en écho ; ni la réponse affichée ni l'historique ne le montrent.
    const r = await v.act('dodone', 'envoyer', { methode: 'GET', url: '{{base}}/echo?api_key={{JETON}}', entetes: 'Authorization: Bearer {{JETON}}', tests: 'code = 200\njson data.id = 7' });
    assert.equal(r.ok, true, r.text); assert.doesNotMatch(r.text, new RegExp(SECRET)); assert.match(r.text, /●●●●/);
    // Auth basic : le service renvoie l'en-tête en écho ; ni le mot de passe ni « bob:mot de passe » en base64 ne s'affichent.
    assert.equal((await v.act('dodone', 'secret', { environnement: 'maison', nom: 'MOTDEPASSE', valeur: 'hunter22xyz' })).ok, true);
    const basic = await v.act('dodone', 'envoyer', { methode: 'GET', url: '{{base}}/echo', entetes: 'Authorization: Basic {{@base64 bob:{{MOTDEPASSE}}}}', tests: 'json auth contient Basic' });
    assert.equal(basic.ok, true, basic.text);
    for (const x of ['hunter22xyz', Buffer.from('bob:hunter22xyz').toString('base64').replace(/=+$/, '')]) assert.ok(!basic.text.includes(x), `${x} masqué`);
    // Une variable manquante dans {{@base64 …}} : erreur claire, rien n'est envoyé.
    const avantManque = recus;
    const manque = await v.act('dodone', 'envoyer', { methode: 'GET', url: '{{base}}/echo', entetes: 'Authorization: Basic {{@base64 bob:{{INCONNU}}}}' });
    assert.equal(manque.ok, false); assert.match(manque.text, /variable\(s\) inconnue\(s\) : INCONNU/); assert.equal(recus, avantManque);
    // Un service sur cette machine (localhost) : permis, il répond.
    const loc = await v.act('dodone', 'envoyer', { methode: 'GET', url: `${base}/echo`, tests: 'code = 200' });
    assert.equal(loc.ok, true, loc.text);
    // Une clé écrite dans le lien à l'enregistrement : au coffre, jamais en base, ni dans la page, ni dans l'export.
    assert.equal((await v.act('dodone', 'collection', { nom: 'Clés' })).ok, true);
    const cle = await v.act('dodone', 'enregistrer', { collection: 'Clés', nom: 'r2', url: '{{base}}/echo?api_key=MONSECRET123', corps: '{"password":"CORPSSECRET9"}', methode: 'POST' });
    assert.equal(cle.ok, true, cle.text); assert.deepEqual((cle.data as { coffre: string[] }).coffre.sort(), ['API_KEY', 'PASSWORD']);
    assert.doesNotMatch(readFileSync(join(ctx.dir, 'versions.jsonl'), 'utf8'), /MONSECRET123|CORPSSECRET9/);
    assert.doesNotMatch(JSON.stringify(await m.view(ctx, new URLSearchParams())), /MONSECRET123|CORPSSECRET9/);
    const exCle = await v.act('dodone', 'exporter', { collection: 'Clés' });
    const texteEx = readFileSync(m.retrait!(ctx, exCle.fichiers![0].ref)!, 'utf8');
    assert.doesNotMatch(texteEx, /MONSECRET123|CORPSSECRET9/); assert.match(texteEx, /api_key=\{\{API_KEY\}\}/);
    const lanceCle = await v.act('dodone', 'lancer_collection', { collection: 'Clés', environnement: 'maison' });
    assert.equal((lanceCle.data as { echecs: number }).echecs, 0, `la clé revient du coffre à l'envoi : ${lanceCle.text}`);
    assert.equal(cleRecue, 'MONSECRET123', 'le service a bien reçu la vraie clé');
    assert.doesNotMatch(lanceCle.text, /MONSECRET123/);
    // Collection importée, enregistrée, lancée.
    assert.equal((await v.act('dodone', 'importer', { contenu: JSON.stringify(POSTMAN) })).ok, true);
    assert.equal((await v.act('dodone', 'collection', { nom: 'Essais' })).ok, true);
    assert.equal((await v.act('dodone', 'enregistrer', { collection: 'Essais', nom: 'clair', url: '{{base}}/echo', entetes: `Authorization: Bearer ${SECRET}` })).ok, false, 'un secret en clair dans un en-tête est refusé');
    assert.equal((await v.act('dodone', 'enregistrer', { collection: 'Essais', nom: 'écho', url: '{{base}}/echo', entetes: 'Authorization: Bearer {{JETON}}', tests: 'code = 200\njson auth contient Bearer' })).ok, true);
    assert.equal((await v.act('dodone', 'enregistrer', { collection: 'Essais', nom: 'absent', url: '{{base}}/rien', tests: 'code = 200' })).ok, true);
    const t0 = Date.now(), avant = recus;
    const l = await v.act('dodone', 'lancer_collection', { collection: 'Essais', environnement: 'maison' });
    assert.equal(l.ok, false); assert.equal((l.data as { echecs: number }).echecs, 1); assert.equal(recus - avant, 2);
    assert.ok(Date.now() - t0 >= 100, 'au moins 100 ms entre deux requêtes');
    assert.ok(evts.includes('collection_terminee') && evts.includes('test_echoue'));
    assert.ok(ctx.alerts({ module: 'dodone' }).some((a) => a.level === 'moyenne'), 'alerte moyenne');
    assert.doesNotMatch(readFileSync(join(ctx.dir, 'envois.jsonl'), 'utf8'), new RegExp(SECRET));
    assert.doesNotMatch(readFileSync(join(ctx.dir, 'versions.jsonl'), 'utf8'), new RegExp(`${SECRET}|clair-dans-la-collection`), 'aucun secret en base');
    assert.doesNotMatch(JSON.stringify(await m.view(ctx, new URLSearchParams())), new RegExp(`${SECRET}|undefined|NaN|\\[object Object\\]`));
    // Export : fichier sans secret.
    const ex = await v.act('dodone', 'exporter', { collection: 'Mon service' });
    assert.doesNotMatch(readFileSync(m.retrait!(ctx, ex.fichiers![0].ref)!, 'utf8'), new RegExp(`${SECRET}|clair-dans-la-collection`));
    // Plafond : 200 requêtes au plus.
    const id = (await v.act('dodone', 'collection', { nom: 'Grosse' })).data as { id: string };
    const { lancerCollection } = await import('../src/valhalla/modules/dodone.ts');
    assert.equal(MAX_COLLECTION, 200);
    const grosse = { id: id.id, nom: 'Grosse', variables: {}, maj: '', requetes: Array.from({ length: 205 }, (_x, k) => ({ id: `r${k}`, nom: `r${k}`, methode: 'GET', url: 'http://piege.test:8888/', entetes: [], tests: [] })) };
    const g = await lancerCollection(ctx, grosse, undefined); assert.equal(g.lignes.length, 200); assert.match(g.lignes[0].erreur ?? '', /réservée|Odin/);
    // Programmée : une tâche dans Talos, lancée par sa propre action.
    assert.equal((await v.act('dodone', 'programmer', { collection: 'Essais', rythme: 'chaque jour', environnement: 'maison' })).ok, true);
    const tache = v.automatismes.lignes().find((x) => x.id.startsWith('tache:dodone:collection-'));
    assert.ok(tache, 'collection programmée visible dans Talos');
    assert.equal((await v.act('dodone', 'programmer', { collection: 'Essais', rythme: 'jamais' })).ok, true);
    assert.equal(v.automatismes.lignes().some((x) => x.id.startsWith('tache:dodone:collection-')), false);
  } finally { v.stop(); }
});
