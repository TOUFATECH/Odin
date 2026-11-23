// Phénix (sindri) : qui peut faire quoi. Un membre de la famille qui a le droit sur Phénix voit l'état des sauvegardes
// (plans, versions, vérification) SANS aucun chemin de la machine, mais ne crée ni ne change un plan, ne pose ni
// n'efface une commande, ne lance pas de sauvegarde, ne restaure rien, n'efface rien, et ne lit jamais le CONTENU des
// sauvegardes du propriétaire (parcourir, chercher, télécharger, ni un lien de fichier fabriqué à la main).
// Une tablette « maison » n'a jamais plus qu'un membre ; une tablette « complet » garde les droits du propriétaire.
// Un vrai Odin d'essai (serveur web + applis), par le même chemin que la page.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';

const MDP = 'une-barque-lente-au-bord-du-lac-62';
const IDS = ['var', 'gladsheim', 'sindri'];
const SECRET = 'CONTENU-SECRET-DU-PROPRIETAIRE-4f2a';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';

async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn }, mdpAvant = process.env.SINDRI_PASSWORD;
let v: VraiOdin, membre = '', dossierProprio = '', ailleurs = '', depot = '', snapId = '', cleMaison = '', cleComplet = '', tuileSauver = '', tuileChercher = '';
const tmp = mkdtempSync(join(tmpdir(), 'sindri-droits-'));
const commeMembre = (module: string, action: string, input: Record<string, unknown> = {}) => v.json('/api/valhalla/act', { module, action, input }, { cookie: membre });
const reserve = (r: { status: number; body: Record<string, unknown> }, quoi: string) => {
  assert.equal(r.status, 403, `${quoi} : refusé (${String(r.body.text ?? r.body.error ?? '').slice(0, 160)})`);
  assert.equal(r.body.code, 'reserve', `${quoi} : réservé au propriétaire`);
};
const plansDe = () => (valhallaOf()!.ctx('sindri').settings.plans as Array<{ name: string; paths: string[]; avant?: string; vms?: number[] }> | undefined) ?? [];

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  process.env.SINDRI_PASSWORD = 'mot-de-passe-de-test-droits';
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  const va = valhallaOf()!;
  // Un dossier du propriétaire, sauvegardé par son plan « Docs » (avec une commande d'avant qu'il a posée).
  dossierProprio = join(tmp, 'proprio-docs'); mkdirSync(dossierProprio, { recursive: true }); writeFileSync(join(dossierProprio, 'secret.txt'), SECRET);
  ailleurs = join(tmp, 'ailleurs'); mkdirSync(ailleurs, { recursive: true }); writeFileSync(join(ailleurs, 'autre.txt'), 'autre');
  depot = join(tmp, 'depot');
  assert.equal((await va.act('sindri', 'creer', { nom: 'Docs', dossiers: dossierProprio, depot, heure: '02:00' })).ok, true);
  assert.equal((await va.act('sindri', 'commandes', { plan: 'Docs', avant: 'echo pret' })).ok, true);
  const s1 = await va.act('sindri', 'sauvegarder', { plan: 'Docs' }); assert.equal(s1.ok, true, s1.text);
  snapId = ((await va.act('sindri', 'instantanes', { plan: 'Docs' })).data as Array<{ id: string }>)[0].id; assert.ok(snapId);
  // Un membre de la famille qui a le droit d'entrer dans Odin et sur Phénix.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-p', nom: 'Membre P', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'sindri']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-p' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer(v, 'membre-p', MDP); assert.ok(membre);
  // Deux tuiles posées par le propriétaire pour l'écran de la maison, et deux clés de tablette.
  tuileSauver = ((await va.act('gladsheim', 'bouton', { appli: 'sindri', action: 'sauvegarder', reglages: 'plan=Docs', nom: 'Sauver' })).data as { id: string }).id;
  tuileChercher = ((await va.act('gladsheim', 'bouton', { appli: 'sindri', action: 'chercher', reglages: 'nom=secret', nom: 'Chercher' })).data as { id: string }).id;
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complet', droits: 'complet' })).data as { key: string }).key;
  assert.ok(tuileSauver && tuileChercher && cleMaison && cleComplet);
});
after(async () => {
  await tt.end(); Object.assign(console, orig);
  if (mdpAvant === undefined) delete process.env.SINDRI_PASSWORD; else process.env.SINDRI_PASSWORD = mdpAvant;
  rmSync(tmp, { recursive: true, force: true });
});

test('membre : ne crée pas de plan sur un dossier du propriétaire, ne change pas le plan du propriétaire', async () => {
  reserve(await commeMembre('sindri', 'creer', { nom: 'Vol', dossiers: dossierProprio, depot: join(tmp, 'depot-membre') }), 'créer un plan');
  reserve(await commeMembre('sindri', 'creer', { nom: 'Docs', dossiers: ailleurs, depot }), 'remplacer le plan du propriétaire');
  assert.deepEqual(plansDe().map((p) => p.name), ['Docs']); assert.deepEqual(plansDe()[0].paths, [dossierProprio]);
  assert.ok(!existsSync(join(tmp, 'depot-membre')), 'aucun dépôt créé');
  reserve(await commeMembre('sindri', 'machines', { plan: 'Docs', vms: '101' }), 'machines virtuelles du plan');
  assert.equal(plansDe()[0].vms, undefined);
});

test('membre : ne pose ni n\'efface une commande avant/après', async () => {
  reserve(await commeMembre('sindri', 'commandes', { plan: 'Docs', avant: '', apres: '' }), 'effacer les commandes');
  reserve(await commeMembre('sindri', 'commandes', { plan: 'Docs', avant: 'calc.exe' }), 'poser une commande');
  assert.equal(plansDe()[0].avant, 'echo pret', 'la commande du propriétaire reste');
});

test('membre : ne lance pas de sauvegarde, ne restaure pas, n\'efface rien', async () => {
  reserve(await commeMembre('sindri', 'sauvegarder', { plan: 'Docs' }), 'sauvegarder maintenant');
  const vers = join(tmp, 'restaure-par-membre');
  reserve(await commeMembre('sindri', 'restaurer', { instantane: snapId, vers }), 'restaurer dans un dossier choisi');
  assert.ok(!existsSync(vers), 'rien n\'est écrit');
  reserve(await commeMembre('sindri', 'restaurer', { instantane: snapId, a_sa_place: true }), 'restaurer par-dessus');
  reserve(await commeMembre('sindri', 'purger', { plan: 'Docs' }), 'purger');
  for (const [a, input] of [['agent_plan', { poste: 'pc-x' }], ['restaurer_pc', { instantane: snapId }], ['image_plan', { machine: 'pc-x' }], ['image_restaurer', { instantane: snapId, machine: 'pc-x', disque: '/dev/sdb' }]] as const)
    reserve(await commeMembre('sindri', a, input), a);
});

test('membre : ne lit jamais le contenu des sauvegardes (parcourir, chercher, télécharger, lien fabriqué)', async () => {
  reserve(await commeMembre('sindri', 'parcourir', { instantane: snapId, dossier: dossierProprio }), 'parcourir');
  reserve(await commeMembre('sindri', 'chercher', { nom: 'secret' }), 'chercher');
  reserve(await commeMembre('sindri', 'telecharger', { instantane: snapId, chemin: join(dossierProprio, 'secret.txt') }), 'télécharger');
  // Un lien de fichier fabriqué à la main avec l'identifiant de la version (que le membre voit) et un chemin deviné.
  for (const chemin of [join(dossierProprio, 'secret.txt'), join(dossierProprio, 'secret.txt').replace(/\\/g, '/')]) {
    const ref = `f/${snapId}/${Buffer.from(chemin).toString('base64url')}`;
    const r = await fetch(`${v.url}/api/valhalla/fichier?module=sindri&ref=${encodeURIComponent(ref)}`, { headers: { cookie: membre } });
    const t = await r.text(); assert.ok(!t.includes(SECRET), 'le contenu ne sort pas par un lien fabriqué'); assert.notEqual(r.status, 200);
  }
  // Même le propriétaire ne reçoit rien d'un lien fabriqué : seuls ceux que « Parcourir » rend sont bons.
  const fab = `f/${snapId}/${Buffer.from(join(dossierProprio, 'secret.txt')).toString('base64url')}`;
  assert.notEqual((await fetch(`${v.url}/api/valhalla/fichier?module=sindri&ref=${encodeURIComponent(fab)}`, { headers: { cookie: v.session } })).status, 200);
});

test('membre : ce qui reste lisible ne montre aucun chemin de la machine', async () => {
  const chemins = [dossierProprio, dossierProprio.replace(/\\/g, '/'), depot, depot.replace(/\\/g, '/'), tmp, tmp.replace(/\\/g, '/')];
  const sansChemin = (t: string, quoi: string) => { for (const c of chemins) assert.ok(!t.includes(c), `${quoi} : aucun chemin (${c})`); };
  for (const a of ['plans', 'instantanes', 'verifier']) {
    const r = await commeMembre('sindri', a, a === 'instantanes' ? { plan: 'Docs' } : {});
    assert.equal(r.status, 200, `${a} reste lisible`); assert.equal(r.body.ok, true, a); sansChemin(JSON.stringify(r.body), a);
  }
  assert.match(String((await commeMembre('sindri', 'plans')).body.text), /Docs/, 'le plan est nommé');
  const vue = await v.json('/api/valhalla/view?id=sindri', undefined, { cookie: membre });
  assert.equal(vue.status, 200); sansChemin(JSON.stringify(vue.body.view), 'la page de Phénix');
  // La page ne montre au membre aucun formulaire ni bouton réservé au propriétaire.
  const json = JSON.stringify(vue.body.view);
  for (const a of ['creer', 'commandes', 'restaurer', 'restaurer_pc', 'parcourir', 'telecharger', 'chercher', 'image_plan', 'sauvegarder']) assert.ok(!json.includes(`"action":"${a}"`), `pas de « ${a} » sur la page du membre`);
});

test('propriétaire : tout marche, chemins compris (page, lecture, lien rendu par Parcourir)', async () => {
  const p = await v.json('/api/valhalla/act', { module: 'sindri', action: 'plans', input: {} });
  assert.equal(p.status, 200); assert.ok(String(p.body.text).includes(dossierProprio), 'le propriétaire voit ses chemins');
  const pc = await v.json('/api/valhalla/act', { module: 'sindri', action: 'parcourir', input: { instantane: snapId, dossier: dossierProprio } });
  assert.equal(pc.status, 200, String(pc.body.text)); const f = (pc.body.fichiers as Array<{ nom: string; ref: string }>).find((x) => x.nom === 'secret.txt')!;
  const r = await fetch(`${v.url}/api/valhalla/fichier?module=sindri&ref=${encodeURIComponent(f.ref)}`, { headers: { cookie: v.session } });
  assert.equal(r.status, 200); assert.equal(await r.text(), SECRET);
  const c = await v.json('/api/valhalla/act', { module: 'sindri', action: 'chercher', input: { nom: 'secret' } });
  assert.match(String(c.body.text), /secret\.txt/);
  const vue = await v.json('/api/valhalla/view?id=sindri');
  assert.ok(JSON.stringify(vue.body.view).includes('"action":"creer"'), 'le propriétaire garde ses formulaires');
});

test('tablettes : « maison » jamais plus qu\'un membre (sauf le bouton de sauvegarde qu\'il a posé), « complet » comme le propriétaire', async () => {
  const M = { 'x-odin-maison': cleMaison, cookie: '' }, C = { 'x-odin-maison': cleComplet, cookie: '' };
  const ch = await v.json('/api/maison/bouton', { id: tuileChercher }, M);
  assert.equal(ch.body.ok, false, 'chercher refusé à la tablette « maison »'); assert.ok(!JSON.stringify(ch.body).includes('secret.txt'));
  const chc = await v.json('/api/maison/bouton', { id: tuileChercher }, C);
  assert.equal(chc.body.ok, true, String(chc.body.text)); assert.match(String(chc.body.text), /secret\.txt/);
  const sv = await v.json('/api/maison/bouton', { id: tuileSauver }, M);
  assert.equal(sv.body.ok, true, `le bouton « Sauvegarder » posé par le propriétaire reste (${String(sv.body.text).slice(0, 120)})`);
});

test('automatismes : la relance d\'une sauvegarde et une lecture d\'état marchent sans le propriétaire en personne', async () => {
  const va = valhallaOf()!;
  const r = await va.act('sindri', 'sauvegarder', { plan: 'Docs' }, { auto: true, by: 'odin', why: 'relance' });
  assert.equal(r.ok, true, r.text);
  assert.equal((await va.act('sindri', 'plans', {}, { auto: true })).ok, true);
  // Une lecture du contenu par une automatisation, elle, ne passe pas.
  assert.equal((await va.act('sindri', 'chercher', { nom: 'secret' }, { auto: true })).ok, false);
  assert.ok(readdirSync(join(depot, 'snapshots')).length >= 2);
});
