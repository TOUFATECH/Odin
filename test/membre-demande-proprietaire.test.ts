// La demande d'un membre de la famille arrive chez le propriétaire : quand un membre (personne de Persona connectée à
// l'interface d'Odin, avec le droit sur l'appli) touche une action grave — page de l'appli, barre des applis, port
// direct —, elle part chez le propriétaire par le validateur d'Odin (le même que pour les demandes venues des
// messageries), avec qui demande, quelle appli et quoi. Oui : l'action part au nom du membre et entre dans « mes
// manips ». Non, ou sans réponse : rien ne part, et le membre l'apprend quand il revient. Une rafale est bornée.
// Ce qu'un membre fait lui-même (actions non graves) est noté à son nom, sans déranger le propriétaire.
// Contrôles : le propriétaire, une tablette, une automatisation, un membre sans le droit, une action « propriétaire
// seul », une invitation et une personne sans session ne changent pas.
// Un vrai Odin d'essai (serveur web + applis), dans un dossier temporaire, sur un port libre.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin, COMPTE, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { directs, holderOf } from '../src/valhalla/directports.ts';
import type { AgentEvent } from '../src/types.ts';
import type { Manip } from '../src/valhalla/types.ts';

const MDP_A = 'un-pont-de-cordes-au-dessus-du-gue-47';
const MDP_B = 'une-lanterne-verte-dans-la-brume-58';
// Persona (var), Chronos (frigg) et Hestia (gladsheim : action « propriétaire seul », tablette).
const IDS = ['var', 'frigg', 'gladsheim'];
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';

/** La connexion d'une personne de Persona à l'interface d'Odin, comme un navigateur : rend le cookie de sa session. */
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, sansDroit = '', avecDroit = '', portDirect = 0, n = 0, cleMaison = '';

const RDV = Array.from({ length: 40 }, (_, i) => `rdv-dem-${i.toString(36).padStart(2, '0')}`);
const rdv = (): string => RDV[n++];
const statut = (id: string) => ((valhallaOf()!.ctx('frigg').settings.bookings as Array<{ id: string; status: string }> | undefined) ?? []).find((b) => b.id === id)?.status;
const manipsDe = (id: string): Manip[] => valhallaOf()!.manips({ limit: 500 }).filter((m) => JSON.stringify(m.input).includes(id));

/** Les demandes de validation reçues par le propriétaire (là où il reçoit celles des messageries : sa discussion). */
const recues: Array<{ peer: string; id: string; summary: string; reason: string }> = [];
const dorm = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function attendre(f: () => boolean, ms = 8000): Promise<boolean> { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await dorm(40); } return true; }
/** Le propriétaire répond à une demande (comme ses boutons Autoriser / Refuser : « /yes id » ou « /no id »). */
const repondre = (id: string, oui: boolean) => v.json('/api/message', { text: `/${oui ? 'yes' : 'no'} ${id}` });

async function poster(base: string, chemin: string, corps: unknown, cookie: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(base + chemin, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1', cookie }, body: JSON.stringify(corps), redirect: 'manual' });
  const t = await r.text(); let b: Record<string, unknown> = {}; try { b = JSON.parse(t) as Record<string, unknown>; } catch { b = { text: t }; }
  return { status: r.status, body: b };
}
const ICI = () => v.url, DIRECT = () => `http://127.0.0.1:${portDirect}`;
const annuler = (id: string, confirm = true) => ({ module: 'frigg', action: 'annuler', input: { id }, confirm });
const phrase = (id: string) => ({ text: `annule le rendez-vous ${id} dans Chronos`, confirm: true });

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  v.o.cfg.web.portsParAppli = false;
  // Le délai du validateur, court pour l'essai (il est lu à chaque demande).
  v.o.cfg.policy.approvalTimeoutSec = 4;
  const ev = v.web.event.bind(v.web);
  v.web.event = (peer: string, e: AgentEvent) => { if (e.type === 'approval') recues.push({ peer, ...(e as unknown as { id: string; summary: string; reason: string }) }); ev(peer, e); };
  const va = valhallaOf()!;
  va.ctx('frigg').saveSettings({ bookings: RDV.map((id, i) => ({ id, service: 'Coupe', name: `Client ${i + 1}`, contact: 'client@example.org', start: '2031-03-04T10:00', end: '2031-03-04T10:30', status: 'confirmé' })) });
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-a', nom: 'Membre A', groupes: 'invite', mot_de_passe: MDP_A })).ok, true);
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-b', nom: 'Membre B', groupes: 'invite', mot_de_passe: MDP_B })).ok, true);
  assert.equal((await va.act('var', 'donner_acces', { appli: 'odin', qui: '@membre-a' })).ok, true);
  for (const appli of ['odin', 'frigg', 'gladsheim']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-b' })).ok, true);
  lierProprietaire(persona()!);
  sansDroit = await entrer(v, 'membre-a', MDP_A); avecDroit = await entrer(v, 'membre-b', MDP_B);
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette essai', droits: 'maison' })).data as { key: string }).key;
  assert.ok(sansDroit && avecDroit && cleMaison);
  const d = directs(); assert.ok(d, 'le gardien des ports directs tourne');
  for (let i = 0; i < 20 && !portDirect; i++) {
    const p = await d.suggest('frigg', 'Données'); if (!p || await holderOf(p)) continue;
    try { await d.set('frigg', p); portDirect = p; } catch { /* pris entre-temps : un autre */ }
  }
  assert.ok(portDirect, 'port direct de Chronos ouvert');
  recues.length = 0;
});
after(async () => {
  // Les demandes encore ouvertes sont refusées : rien ne reste en attente.
  for (const x of recues) await repondre(x.id, false).catch(() => undefined);
  try { await directs()?.remove('frigg'); } catch { /* déjà fermé */ }
  await tt.end(); Object.assign(console, orig);
});

// ---------------------------------------------------------------- la demande arrive chez le propriétaire
for (const [nom, base] of [['la page de l\'appli', ICI], ['le port direct de l\'appli', DIRECT]] as const) {
  test(`membre avec le droit, ${nom} : la demande arrive chez le propriétaire ; son oui la fait partir au nom du membre`, async () => {
    const id = rdv(), avant = recues.length, r = await poster(base(), '/api/valhalla/act', annuler(id), avecDroit);
    assert.equal(statut(id), 'confirmé', 'rien ne part avant sa réponse');
    assert.notEqual(r.body.ok, true); assert.equal(r.body.confirm, undefined, 'aucune confirmation proposée au membre');
    assert.match(String(r.body.text), new RegExp(`^Demande envoyée à ${COMPTE.prenom}`), JSON.stringify(r.body));
    assert.ok(await attendre(() => recues.length === avant + 1), 'une demande reçue par le propriétaire');
    const q = recues.at(-1)!;
    assert.equal(q.peer, 'principal', 'là où il reçoit les demandes des messageries (sa discussion)');
    assert.match(q.summary, /Membre B/); assert.match(q.summary, /Chronos/); assert.match(q.summary, new RegExp(`annuler le rendez-vous ${id}`, 'i'));
    // Le membre ne répond pas lui-même à sa demande.
    const lui = await poster(ICI(), '/api/message', { text: `/yes ${q.id}` }, avecDroit);
    assert.equal(lui.status, 403); await dorm(150); assert.equal(statut(id), 'confirmé');
    assert.equal((await repondre(q.id, true)).status, 202);
    assert.ok(await attendre(() => statut(id) === 'annulé'), 'son oui fait partir l\'action');
    const m = manipsDe(id);
    assert.equal(m.length, 1, JSON.stringify(m)); assert.equal(m[0].by, 'membre'); assert.equal(m[0].par?.login, 'membre-b');
    assert.equal(m[0].module, 'frigg'); assert.equal(m[0].action, 'annuler');
  });
}
test('membre avec le droit, la barre des applis : la demande part ; son non : rien ne part, le membre l\'apprend en revenant', async () => {
  const id = rdv(), avant = recues.length, r = await poster(ICI(), '/api/valhalla/order', phrase(id), avecDroit);
  assert.match(String(r.body.text), /^Demande envoyée à/, JSON.stringify(r.body)); assert.equal(r.body.confirm, undefined);
  assert.ok(await attendre(() => recues.length === avant + 1));
  assert.match(recues.at(-1)!.summary, new RegExp(id));
  await repondre(recues.at(-1)!.id, false); await dorm(300);
  assert.equal(statut(id), 'confirmé'); assert.deepEqual(manipsDe(id), []);
  // Il revient (une action à lui, non grave) : la réponse lui dit que sa demande n'a pas été validée.
  const autre = rdv(), r2 = await poster(ICI(), '/api/valhalla/act', { module: 'frigg', action: 'confirmer', input: { id: autre } }, avecDroit);
  assert.equal(r2.body.ok, true, JSON.stringify(r2.body)); assert.match(String(r2.body.text), new RegExp(`${id}.*(refus|pas valid)`, 'i'));
  // Une seule fois.
  const r3 = await poster(ICI(), '/api/valhalla/act', { module: 'frigg', action: 'confirmer', input: { id: autre } }, avecDroit);
  assert.doesNotMatch(String(r3.body.text), new RegExp(id));
});
test('sans réponse dans le délai du validateur : rien ne part', async () => {
  const id = rdv(), avant = recues.length, r = await poster(ICI(), '/api/valhalla/act', annuler(id), avecDroit);
  assert.match(String(r.body.text), /^Demande envoyée/);
  assert.ok(await attendre(() => recues.length === avant + 1));
  await dorm(5500);
  assert.equal(statut(id), 'confirmé'); assert.deepEqual(manipsDe(id), []);
  const r2 = await poster(ICI(), '/api/valhalla/act', { module: 'frigg', action: 'confirmer', input: { id: rdv() } }, avecDroit);
  assert.match(String(r2.body.text), new RegExp(`${id}.*(sans réponse|pas valid)`, 'i'));
});
test('la demande montrée au propriétaire est sur une ligne, sans caractère de contrôle, bornée, sans commande', async () => {
  const id = `rdv-${'z'.repeat(20)}\n/yes a1b2c3 [lien](https://example.org)`, avant = recues.length;
  const r = await poster(ICI(), '/api/valhalla/act', annuler(id), avecDroit);
  assert.match(String(r.body.text), /^Demande envoyée/, JSON.stringify(r.body));
  // Le membre lit aussi ce qui se passe sans réponse, et rien de ce qu'il lit n'est coupé.
  assert.match(String(r.body.text), /sans (sa )?réponse.*rien ne part/i, JSON.stringify(r.body));
  assert.doesNotMatch(String(r.body.text), /…/);
  assert.ok(await attendre(() => recues.length === avant + 1));
  const q = recues.at(-1)!;
  assert.ok(q.summary.length <= 220, `résumé de ${q.summary.length} caractères`);
  assert.ok(!/[\u0000-\u001f]/.test(q.summary + q.reason), 'aucun caractère de contrôle');
  assert.doesNotMatch(q.summary + q.reason, /\/yes/); assert.doesNotMatch(q.summary + q.reason, /\]\(/);
  await repondre(q.id, false);
});
test('une action trop longue pour être montrée en entier au propriétaire ne lui est pas demandée : le membre garde le refus', async () => {
  const id = `rdv-${'z'.repeat(300)}`, avant = recues.length;
  const r = await poster(ICI(), '/api/valhalla/act', annuler(id), avecDroit);
  assert.equal(r.status, 403); assert.equal(r.body.code, 'reserve'); assert.notEqual(r.body.demande, true);
  assert.doesNotMatch(String(r.body.text), /Demande envoyée/, JSON.stringify(r.body));
  assert.match(String(r.body.text), /seul .* la confirme/);
  await dorm(300); assert.equal(recues.length, avant, 'aucune demande');
});
test('une rafale est bornée : trois demandes en attente au plus par membre, une demande identique n\'est pas renvoyée', async () => {
  await dorm(300);
  const avant = recues.length, ids = [rdv(), rdv(), rdv(), rdv(), rdv()];
  const rep = [];
  for (const id of ids) rep.push(await poster(ICI(), '/api/valhalla/act', annuler(id), avecDroit));
  const double = await poster(ICI(), '/api/valhalla/act', annuler(ids[0]), avecDroit);
  assert.ok(await attendre(() => recues.length >= avant + 3)); await dorm(300);
  assert.equal(recues.length, avant + 3, 'trois demandes au plus');
  for (const r of rep.slice(0, 3)) assert.match(String(r.body.text), /^Demande envoyée/);
  for (const r of rep.slice(3)) { assert.notEqual(r.body.ok, true); assert.match(String(r.body.text), /en attente/); assert.match(String(r.body.text), /propriétaire/); }
  assert.match(String(double.body.text), /déjà envoyée/);
  for (const q of recues.slice(avant)) await repondre(q.id, false);
  await dorm(300);
  for (const id of ids) assert.equal(statut(id), 'confirmé');
});

// ---------------------------------------------------------------- au nom du membre
test('une action non grave d\'un membre est notée à son nom dans « mes manips », sans déranger le propriétaire', async () => {
  const id = rdv(), avant = recues.length, notes = v.notified.length;
  const r = await poster(ICI(), '/api/valhalla/act', { module: 'frigg', action: 'confirmer', input: { id } }, avecDroit);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const m = manipsDe(id);
  assert.equal(m.length, 1, JSON.stringify(m)); assert.equal(m[0].by, 'membre'); assert.equal(m[0].par?.login, 'membre-b'); assert.equal(m[0].par?.name, 'Membre B');
  assert.equal(m[0].state, 'gardée', 'rien à décider : il en avait le droit');
  assert.equal(recues.length, avant, 'aucune demande'); await dorm(100); assert.equal(v.notified.length, notes, 'aucun message au propriétaire');
  // Visible par le propriétaire, pas par le membre.
  const p = await v.json('/api/valhalla/manips');
  assert.ok((p.body.manips as Manip[]).some((x) => x.par?.login === 'membre-b' && JSON.stringify(x.input).includes(id)));
  const mb = await fetch(`${v.url}/api/valhalla/manips`, { headers: { cookie: avecDroit } }).then((x) => x.json()) as { manips: unknown[] };
  assert.deepEqual(mb.manips, []);
});
test('noter au nom du membre ne rouvre aucun droit : sans le droit sur l\'appli, toujours refusé', async () => {
  const id = rdv(), avant = recues.length;
  const a = await poster(ICI(), '/api/valhalla/act', { module: 'frigg', action: 'confirmer', input: { id } }, sansDroit);
  assert.equal(a.status, 403); assert.equal(a.body.code, 'refuse');
  const g = await poster(ICI(), '/api/valhalla/act', annuler(id), sansDroit);
  assert.equal(g.status, 403); assert.equal(g.body.code, 'refuse');
  const o = await poster(ICI(), '/api/valhalla/order', phrase(id), sansDroit);
  assert.notEqual(o.body.ok, true); assert.match(String(o.body.text), /pas accès à Chronos/);
  await dorm(200); assert.equal(recues.length, avant, 'aucune demande'); assert.deepEqual(manipsDe(id), []); assert.equal(statut(id), 'confirmé');
});

// ---------------------------------------------------------------- contrôles : ce qui ne change pas
test('contrôle : le propriétaire confirme lui-même ; rien ne lui est demandé ; rien dans « mes manips »', async () => {
  const id = rdv(), avant = recues.length;
  const sans = await v.json('/api/valhalla/act', annuler(id, false));
  assert.match(String(sans.body.confirm), /annuler le rendez-vous/); assert.equal(statut(id), 'confirmé');
  const avec = await v.json('/api/valhalla/act', annuler(id));
  assert.equal(avec.body.ok, true, JSON.stringify(avec.body)); assert.equal(statut(id), 'annulé');
  const b = rdv(), o = await v.json('/api/valhalla/order', phrase(b));
  assert.equal(o.body.ok, true, JSON.stringify(o.body)); assert.equal(statut(b), 'annulé');
  const c = rdv(), conf = await v.json('/api/valhalla/act', { module: 'frigg', action: 'confirmer', input: { id: c } });
  assert.equal(conf.body.ok, true);
  await dorm(200); assert.equal(recues.length, avant);
  for (const x of [id, b, c]) assert.deepEqual(manipsDe(x), []);
});
test('contrôle : une automatisation ne fait toujours pas d\'action grave (aucune demande), et le reste est noté comme avant', async () => {
  const id = rdv(), avant = recues.length, va = valhallaOf()!;
  const r = await va.act('frigg', 'annuler', { id }, { auto: true });
  assert.equal(r.ok, false); assert.match(r.text, /automatisation/); assert.equal(statut(id), 'confirmé');
  assert.equal((await va.act('frigg', 'confirmer', { id }, { auto: true })).ok, true);
  const m = manipsDe(id); assert.equal(m.length, 1); assert.equal(m[0].by, 'automatisation'); assert.equal(m[0].par, undefined);
  await dorm(100); assert.equal(recues.length, avant);
});
test('contrôle : une tablette garde ses droits, et rien n\'est demandé ni noté au nom d\'un membre', async () => {
  const avant = recues.length, K = { 'x-odin-maison': cleMaison, cookie: '' };
  const e = await v.json('/api/maison/etat', undefined, K);
  assert.equal(e.status, 200); assert.equal(e.body.rights, 'maison');
  const a = await v.json('/api/maison/appareil', { appareil: 'light.salon', valeur: 'on' }, K);
  assert.equal(a.status, 200);
  await dorm(100); assert.equal(recues.length, avant);
  assert.ok(!valhallaOf()!.manips({ limit: 500 }).some((x) => x.by === 'membre' && x.module === 'gladsheim'));
});
test('contrôle : une action « propriétaire seul » reste refusée au membre, sans demande (page et barre)', async () => {
  const avant = recues.length, cles = () => JSON.stringify(valhallaOf()!.ctx('gladsheim').settings.keys ?? valhallaOf()!.ctx('gladsheim').settings.cles ?? null);
  const k0 = cles();
  const r = await poster(ICI(), '/api/valhalla/act', { module: 'gladsheim', action: 'cle_tablette', input: { nom: 'Cle membre', droits: 'maison' }, confirm: true }, avecDroit);
  assert.equal(r.status, 403); assert.equal(r.body.code, 'reserve'); assert.doesNotMatch(String(r.body.text), /Demande envoyée/);
  const o = await poster(ICI(), '/api/valhalla/order', { text: 'crée une clé de tablette Entree dans Hestia', confirm: true }, avecDroit);
  assert.notEqual(o.body.ok, true, JSON.stringify(o.body)); assert.doesNotMatch(String(o.body.text), /Demande envoyée/);
  await dorm(200); assert.equal(recues.length, avant, 'aucune demande'); assert.equal(cles(), k0);
});
test('contrôle : une invitation et une personne sans session ne changent pas', async () => {
  const avant = recues.length, id = rdv();
  const inv = await fetch(`${v.url}/sso/invitation?j=inconnu`, { redirect: 'manual' }); await inv.text();
  assert.ok(inv.status < 500, `invitation : ${inv.status}`);
  const anonyme = await poster(ICI(), '/api/valhalla/act', annuler(id), '');
  assert.ok(anonyme.status === 401 || anonyme.status === 403, String(anonyme.status));
  await dorm(100); assert.equal(recues.length, avant); assert.equal(statut(id), 'confirmé');
});

// ---------------------------------------------------------------- ce qu'un membre fait ne change rien à ce qu'Odin a fait seul
test('« garde la dernière » ou « annule la dernière » du propriétaire visent ce qu\'Odin a fait seul, jamais l\'action d\'un membre', async () => {
  const va = valhallaOf()!, id = rdv();
  assert.equal((await va.act('frigg', 'confirmer', { id }, { by: 'odin' })).ok, true);
  const odin = va.manips({ limit: 500 }).find((x) => x.by === 'odin' && JSON.stringify(x.input).includes(id));
  assert.ok(odin); assert.equal(odin.state, 'à décider');
  const r = await poster(ICI(), '/api/valhalla/act', { module: 'frigg', action: 'confirmer', input: { id: rdv() } }, avecDroit);
  assert.equal(r.body.ok, true, JSON.stringify(r.body)); assert.equal(va.manips({ limit: 1 })[0].by, 'membre');
  const d = await va.decide('dernière', true);
  assert.deepEqual(d.manips.map((x) => x.id), [odin.id], d.text);
});
test('les actions d\'un membre, même nombreuses, ne chassent pas du journal ce qu\'Odin a fait seul et qui attend ta décision', async () => {
  const va = valhallaOf()!, id = rdv(), cible = rdv();
  assert.equal((await va.act('frigg', 'confirmer', { id }, { by: 'odin' })).ok, true);
  const odin = va.manips({ limit: 500 }).find((x) => x.by === 'odin' && JSON.stringify(x.input).includes(id));
  assert.ok(odin); assert.equal(odin.state, 'à décider');
  let ok = 0;
  for (let i = 0; i < 505; i++) if ((await poster(ICI(), '/api/valhalla/act', { module: 'frigg', action: 'confirmer', input: { id: cible } }, avecDroit)).body.ok === true) ok++;
  assert.equal(ok, 505);
  const tout = va.manips({ limit: 5000 });
  assert.ok(tout.some((x) => x.id === odin.id && x.state === 'à décider'), 'la manip d\'Odin attend toujours ta décision');
  // Ce que fait un membre reste borné (le journal ne grossit pas sans fin), et c'est le plus récent qui est gardé.
  const deLui = tout.filter((x) => x.par?.login === 'membre-b');
  assert.ok(deLui.length > 0 && deLui.length <= 200, String(deLui.length));
  assert.ok(JSON.stringify(deLui[0].input).includes(cible));
  const d = await va.decide(odin.id, true);
  assert.equal(d.ok, true, d.text); assert.deepEqual(d.manips.map((x) => x.id), [odin.id]);
});
