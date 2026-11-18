// Un membre de la famille (personne de Persona connectée à l'interface d'Odin) ne confirme pas lui-même une action
// grave d'une appli à laquelle il a droit : ni par la page de l'appli (/api/valhalla/act), ni par la barre des applis
// (/api/valhalla/order), ni par le port direct de l'appli. Seul le propriétaire d'Odin la confirme.
// Contrôles : le propriétaire, une automatisation, un membre sans le droit, une action « propriétaire seul », une
// action non grave du membre et les choses qu'un membre fait sans validation restent comme avant.
// Un vrai Odin d'essai (serveur web + applis), dans un dossier temporaire, sur un port libre.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { directs, holderOf } from '../src/valhalla/directports.ts';
import { aegir } from '../src/valhalla/modules/aegir.ts';
import { dvalinn } from '../src/valhalla/modules/dvalinn.ts';
import { midgard } from '../src/valhalla/modules/midgard.ts';
import { ullr } from '../src/valhalla/modules/ullr.ts';
import { frigg } from '../src/valhalla/modules/frigg.ts';
import { connexions } from '../src/valhalla/sso/connexions.ts';
import type { Module } from '../src/valhalla/types.ts';

const MDP_A = 'un-sentier-de-sable-sous-les-pins-31';
const MDP_B = 'une-barque-lente-au-bord-du-lac-62';
// Persona (var), Chronos (frigg) et Hestia (gladsheim, pour une action « propriétaire seul »).
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
let v: VraiOdin, sansDroit = '', avecDroit = '', portDirect = 0, n = 0;

// Les rendez-vous de Chronos de l'essai, tous posés au départ : la barre des applis garde 30 secondes la liste de ceux
// qu'elle connaît, un rendez-vous ajouté ensuite ne serait pas reconnu dans la phrase.
const RDV = Array.from({ length: 20 }, (_, i) => `rdv-essai-${'abcdefghijklmnopqrstuvwxyz'[i]}`);
/** Le rendez-vous suivant (encore « confirmé »), rend son identifiant. */
const rdv = (): string => RDV[n++];
const statut = (id: string) => ((valhallaOf()!.ctx('frigg').settings.bookings as Array<{ id: string; status: string }> | undefined) ?? []).find((b) => b.id === id)?.status;
const manipsDe = (id: string) => valhallaOf()!.manips({ limit: 500 }).filter((m) => JSON.stringify(m.input).includes(id));

/** Une requête de l'interface, sur le port d'Odin ou sur un port direct. */
async function poster(base: string, chemin: string, corps: unknown, cookie: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(base + chemin, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1', cookie }, body: JSON.stringify(corps), redirect: 'manual' });
  const t = await r.text(); let b: Record<string, unknown> = {}; try { b = JSON.parse(t) as Record<string, unknown>; } catch { b = { text: t }; }
  return { status: r.status, body: b };
}
const ICI = () => v.url, DIRECT = () => `http://127.0.0.1:${portDirect}`;
const annuler = (id: string, confirm = true) => ({ module: 'frigg', action: 'annuler', input: { id }, confirm });
const phrase = (id: string, confirm = true) => ({ text: `annule le rendez-vous ${id} dans Chronos`, confirm });

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  // Pas de port direct par défaut pendant l'essai : seul celui de Chronos, ouvert ci-dessous sur cette machine.
  v.o.cfg.web.portsParAppli = false;
  const va = valhallaOf()!;
  va.ctx('frigg').saveSettings({ bookings: RDV.map((id, i) => ({ id, service: 'Coupe', name: `Client ${i + 1}`, contact: 'client@example.org', start: '2031-03-04T10:00', end: '2031-03-04T10:30', status: 'confirmé' })) });
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-a', nom: 'Membre A', groupes: 'invite', mot_de_passe: MDP_A })).ok, true);
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-b', nom: 'Membre B', groupes: 'invite', mot_de_passe: MDP_B })).ok, true);
  assert.equal((await va.act('var', 'donner_acces', { appli: 'odin', qui: '@membre-a' })).ok, true);
  for (const appli of ['odin', 'frigg', 'gladsheim']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-b' })).ok, true);
  lierProprietaire(persona()!);
  sansDroit = await entrer(v, 'membre-a', MDP_A); avecDroit = await entrer(v, 'membre-b', MDP_B);
  assert.ok(sansDroit && avecDroit, 'les deux membres ont une session');
  // Le port direct de Chronos : un port du plan, libre sur la machine (personne ne l'écoute), ouvert sur la boucle locale.
  const d = directs(); assert.ok(d, 'le gardien des ports directs tourne');
  for (let i = 0; i < 20 && !portDirect; i++) {
    const p = await d.suggest('frigg', 'Données'); if (!p || await holderOf(p)) continue;
    try { await d.set('frigg', p); portDirect = p; } catch { /* pris entre-temps : un autre */ }
  }
  assert.ok(portDirect, 'port direct de Chronos ouvert'); assert.equal(d.status('frigg')?.etat, 'écoute');
});
after(async () => { try { await directs()?.remove('frigg'); } catch { /* déjà fermé */ } await tt.end(); Object.assign(console, orig); });

// ---------------------------------------------------------------- le membre avec le droit, action grave
for (const [nom, base] of [['la page de l\'appli', ICI], ['le port direct de l\'appli', DIRECT]] as const) {
  test(`membre avec le droit, ${nom} : une action grave confirmée par lui ne part pas`, async () => {
    const id = rdv(), r = await poster(base(), '/api/valhalla/act', annuler(id), avecDroit);
    assert.equal(statut(id), 'confirmé', `le rendez-vous n'est pas annulé (réponse ${r.status} : ${JSON.stringify(r.body)})`);
    assert.notEqual(r.body.ok, true);
    assert.equal(r.status, 403); assert.equal(r.body.code, 'reserve');
    assert.match(String(r.body.text), /propriétaire/);
  });
  test(`membre avec le droit, ${nom} : sans sa confirmation non plus, et on ne lui propose pas de confirmer`, async () => {
    const id = rdv(), r = await poster(base(), '/api/valhalla/act', annuler(id, false), avecDroit);
    assert.equal(statut(id), 'confirmé');
    assert.equal(r.body.confirm, undefined, `aucune confirmation proposée au membre (réponse : ${JSON.stringify(r.body)})`);
    assert.equal(r.status, 403);
  });
}
for (const [nom, base] of [['la barre des applis', ICI], ['la barre des applis par le port direct', DIRECT]] as const) {
  test(`membre avec le droit, ${nom} : une phrase grave confirmée par lui ne part pas`, async () => {
    const id = rdv(), r = await poster(base(), '/api/valhalla/order', phrase(id), avecDroit);
    assert.equal(statut(id), 'confirmé', `le rendez-vous n'est pas annulé (réponse ${r.status} : ${JSON.stringify(r.body)})`);
    assert.notEqual(r.body.ok, true);
    assert.equal(r.body.confirm, undefined, 'aucune confirmation proposée au membre');
    assert.equal(r.status, 403, JSON.stringify(r.body)); assert.match(String(r.body.text), /propriétaire/);
  });
}

// ---------------------------------------------------------------- contrôles : ce qui ne change pas
test('contrôle : la phrase de l\'essai est bien comprise comme l\'annulation (le propriétaire reçoit la demande de confirmation)', async () => {
  const id = rdv(), r = await v.json('/api/valhalla/order', phrase(id, false));
  assert.equal(statut(id), 'confirmé');
  assert.match(String(r.body.confirm), /annuler le rendez-vous/, JSON.stringify(r.body));
});
test('contrôle : le propriétaire confirme toujours lui-même (page, barre, port direct)', async () => {
  const a = rdv(), sans = await v.json('/api/valhalla/act', annuler(a, false));
  assert.match(String(sans.body.confirm), /annuler le rendez-vous/); assert.equal(statut(a), 'confirmé');
  const avec = await v.json('/api/valhalla/act', annuler(a));
  assert.equal(avec.status, 200); assert.equal(avec.body.ok, true, JSON.stringify(avec.body)); assert.equal(statut(a), 'annulé');
  const b = rdv(), o = await v.json('/api/valhalla/order', phrase(b));
  assert.equal(o.body.ok, true, `${b} ${JSON.stringify(o.body)}`); assert.equal(statut(b), 'annulé');
  const c = rdv(), dp = await poster(DIRECT(), '/api/valhalla/act', annuler(c), v.session);
  assert.equal(dp.body.ok, true, JSON.stringify(dp.body)); assert.equal(statut(c), 'annulé');
  // Le propriétaire n'entre pas dans « mes manips » (comme avant).
  for (const id of [a, b, c]) assert.deepEqual(manipsDe(id), []);
});
test('contrôle : une automatisation ne fait toujours pas d\'action grave, et fait le reste', async () => {
  const id = rdv(), va = valhallaOf()!;
  const r = await va.act('frigg', 'annuler', { id }, { auto: true });
  assert.equal(r.ok, false); assert.match(r.text, /automatisation/); assert.equal(statut(id), 'confirmé');
  assert.equal((await va.act('frigg', 'confirmer', { id }, { auto: true })).ok, true);
});
test('contrôle : un membre sans le droit sur l\'appli est toujours refusé', async () => {
  const id = rdv();
  const a = await poster(ICI(), '/api/valhalla/act', annuler(id), sansDroit);
  assert.equal(a.status, 403); assert.equal(a.body.code, 'refuse');
  const o = await poster(ICI(), '/api/valhalla/order', phrase(id), sansDroit);
  assert.notEqual(o.body.ok, true); assert.match(String(o.body.text), /pas accès à Chronos/);
  const d = await poster(DIRECT(), '/api/valhalla/act', annuler(id), sansDroit);
  assert.equal(d.status, 403);
  assert.equal(statut(id), 'confirmé');
});
test('contrôle : une action « propriétaire seul » reste refusée au membre, même confirmée', async () => {
  const avant = JSON.stringify(valhallaOf()!.ctx('gladsheim').settings.fenetre ?? null);
  const r = await poster(ICI(), '/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify({ pages: [{ name: 'Page membre', widgets: [{ kind: 'heure' }] }] }) }, confirm: true }, avecDroit);
  assert.equal(r.status, 403); assert.equal(r.body.code, 'reserve');
  assert.equal(JSON.stringify(valhallaOf()!.ctx('gladsheim').settings.fenetre ?? null), avant);
});
test('contrôle : une action non grave du membre part toujours (page et port direct)', async () => {
  const a = rdv(), r = await poster(ICI(), '/api/valhalla/act', { module: 'frigg', action: 'confirmer', input: { id: a } }, avecDroit);
  assert.equal(r.status, 200); assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const d = await poster(DIRECT(), '/api/valhalla/act', { module: 'frigg', action: 'prestation', input: { nom: 'Brushing', minutes: 30 } }, avecDroit);
  assert.equal(d.body.ok, true, JSON.stringify(d.body));
  assert.ok(((valhallaOf()!.ctx('frigg').settings.services as Array<{ name: string }> | undefined) ?? []).some((s) => s.name === 'Brushing'));
});
// Les choses qu'un membre fait faire sans validation (noter, rappeler, musique, lumière, convertir, analyser un fichier) :
// leurs actions d'appli ne sont pas graves, la règle des actions graves ne les touche donc pas.
test('contrôle : les actions d\'appli des choses libres d\'un membre ne sont pas graves', () => {
  const g = (m: Module, a: string, i: Record<string, unknown>) => { const x = m.actions.find((y) => y.id === a); assert.ok(x, `${m.id}.${a}`); return x.grave?.(i, undefined as never); };
  assert.equal(g(aegir, 'jouer', { quoi: 'une chanson' }), undefined, 'musique');
  assert.equal(g(midgard, 'commander', { appareil: 'light.salon', valeur: 'on' }) || undefined, undefined, 'lumière');
  assert.equal(g(dvalinn, 'convertir', { fichier: 'essai.docx', vers: 'pdf' }), undefined, 'convertir');
  assert.equal(g(ullr, 'fichier', { fichier: 'essai.txt' }), undefined, 'analyser un fichier');
  // Rappeler : un rappel d'un membre passe par la messagerie (pas par une appli) ; l'action d'appli qui pose un rappel
  // (un rendez-vous à soi dans Chronos) n'est pas grave non plus.
  assert.equal(g(frigg, 'rendez_vous', { titre: 'Essai', quand: '2031-03-04 10:00' }), undefined, 'rappeler');
  const thot = allModules(v.o).find((m) => m.id === 'saga')!;
  assert.equal(g(thot, 'noter', { titre: 'Essai', texte: 'x' }), undefined, 'noter');
});

// ---------------------------------------------------------------- le refus lui-même : lisible, borné, journal entier
test('le refus d\'une action grave est borné, sur une ligne, et commence par une majuscule', async () => {
  const id = `rdv-${'x'.repeat(300)}\nligne`, r = await poster(ICI(), '/api/valhalla/act', annuler(id), avecDroit);
  assert.equal(r.status, 403); assert.equal(r.body.code, 'reserve');
  const t = String(r.body.text);
  assert.ok(t.length <= 240, `refus de ${t.length} caractères`);
  assert.ok(!/[\u0000-\u001f]/.test(t), 'aucun caractère de contrôle');
  assert.match(t, /^\p{Lu}/u, t);
});
test('le journal de connexion garde la fin « réservé au propriétaire » d\'un refus grave', async () => {
  const id = `rdv-${'y'.repeat(200)}`; await poster(ICI(), '/api/valhalla/act', annuler(id), avecDroit);
  const e = connexions(valhallaOf()!.ctx('var')).tout().filter((x) => x.login === 'membre-b' && /action grave/.test(x.why)).at(-1);
  assert.ok(e, 'refus noté'); assert.match(e.why, /réservé au propriétaire$/, e.why);
});
test('sans prénom du propriétaire, le refus ne se répète pas', async () => {
  const m = await import('../src/valhalla/sso/garde.ts') as Record<string, unknown>;
  assert.equal(typeof m.refusGrave, 'function', 'refusGrave exporté');
  const f = m.refusGrave as (c: string, p: string) => { quoi: string; texte: string };
  assert.doesNotMatch(f('Confirmer : annuler le rendez-vous a ?', 'l\'administrateur d\'Odin').texte, /Odin.*\(le propriétaire d'Odin\)/);
  assert.match(f('Confirmer : annuler le rendez-vous a ?', 'Awa').texte, /^Annuler le rendez-vous a : .*Awa \(le propriétaire d'Odin\)/);
});
