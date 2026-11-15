// Connexion sur le port d'une appli : e-mail et mot de passe (le propriétaire, ou une personne de Persona), ou QR code
// scanné par un téléphone déjà connecté. Avec le droit sur l'appli : on entre. Sans le droit : pas de session, et
// retour à l'écran de connexion d'Odin (son port à lui). Essais sur un VRAI Odin (vrai serveur, vrais ports directs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T, freePort } from './banc/lib.ts';
import { vraiOdin, COMPTE } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { ConnexionQr, DUREE_QR } from '../src/web/connexion-qr.ts';
import { directOpen } from '../src/valhalla/directports.ts';

const MDP_MOUSSA = 'girafe-orange-sous-la-pluie-42';
const IDS = ['var', 'freyja', 'garmr', 'hlid'];
const cookieDe = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0] ?? '';

test('QR code : une demande, une décision, une seule entrée ; secret exigé ; expiration ; limites', () => {
  const q = new ConnexionQr(), t0 = 1_000_000;
  const d = q.debut('Mozilla/5.0 (Windows NT 10.0) Chrome/130', '192.168.1.30', 'garmr', t0)!;
  assert.match(d.code, /^[A-Z2-9]{8}$/); assert.match(d.secret, /^[0-9a-f]{48}$/);
  assert.deepEqual(q.voir(d.code.toLowerCase(), t0), { code: d.code, appareil: 'Chrome sur Windows', ip: '192.168.1.30', appli: 'garmr', debut: t0, etat: 'attente' });
  assert.deepEqual(q.collecter(d.secret, t0), { etat: 'attente' });
  assert.deepEqual(q.collecter('mauvais-secret', t0), { etat: 'expire' }, 'le code seul ne suffit pas : il faut le secret de l\'écran');
  assert.equal(q.decider(d.code, { login: 'moussa' }, true, t0)!.etat, 'ok');
  assert.equal(q.decider(d.code, { proprio: true }, false, t0)!.etat, 'ok', 'une décision prise ne change plus');
  assert.deepEqual(q.collecter(d.secret, t0), { etat: 'ok', qui: { login: 'moussa' }, appli: 'garmr' });
  assert.deepEqual(q.collecter(d.secret, t0), { etat: 'expire' }, 'une seule entrée');
  const r = q.debut('', '192.168.1.30', undefined, t0)!; q.decider(r.code, { proprio: true }, false, t0);
  assert.deepEqual(q.collecter(r.secret, t0), { etat: 'refus' });
  const e = q.debut('', '192.168.1.30', undefined, t0)!;
  assert.equal(q.voir(e.code, t0 + DUREE_QR + 1), undefined, 'expirée après 3 minutes'); assert.deepEqual(q.collecter(e.secret, t0 + DUREE_QR + 1), { etat: 'expire' });
  const l = new ConnexionQr(); for (let i = 0; i < 5; i++) assert.ok(l.debut('', '10.0.0.9', undefined, t0));
  assert.equal(l.debut('', '10.0.0.9', undefined, t0), undefined, '5 demandes par adresse et par 10 minutes');
  assert.ok(l.debut('', '10.0.0.10', undefined, t0), 'une autre adresse peut encore demander');
});

test('port direct : sans session, seuls l\'écran de connexion, la connexion et le QR code de l\'écran passent', () => {
  for (const p of ['/api/account/login', '/api/account/logout', '/api/connexion-qr/debut', '/api/connexion-qr/etat']) assert.equal(directOpen('POST', p), true, p);
  for (const p of ['/api/connexion-qr/decider', '/api/connexion-qr/voir', '/api/account/create', '/api/pair']) assert.equal(directOpen('POST', p), false, p);
  assert.equal(directOpen('GET', '/connexion-qr'), false, 'la page du téléphone n\'est pas servie sans session sur un port direct');
});

test('connexion sur le port d\'une appli : mot de passe ou QR code, droits vérifiés, sinon retour à l\'écran de connexion d\'Odin', { timeout: 180_000 }, async (t) => {
  const tt = new T(), orig = console.log; console.log = () => {};
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) }), va = valhallaOf()!;
    assert.equal((await va.act('var', 'ajouter', { login: 'moussa', nom: 'Moussa', groupes: 'famille', email: 'moussa@exemple.yt', mot_de_passe: MDP_MOUSSA })).ok, true);
    const ports: Record<string, number> = {};
    for (const appli of ['freyja', 'garmr']) {
      ports[appli] = await freePort();
      const r = (await v.json('/api/ports', { appli, faire: 'regler', port: ports[appli] })).body as { ok: boolean; text?: string }; assert.equal(r.ok, true, JSON.stringify(r));
    }
    const sur = (appli: string) => `http://127.0.0.1:${ports[appli]}`, accueilCerbere = `${v.url}/?refus=Cerb%C3%A8re`;
    const post = (base: string, path: string, body: unknown, h: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1', ...h }, body: JSON.stringify(body) });

    await t.test('mot de passe : le propriétaire entre partout ; Moussa (famille) entre dans Vénus, pas dans Cerbère', async () => {
      let r = await post(sur('garmr'), '/api/account/login', { email: COMPTE.email, password: COMPTE.password }); assert.equal(r.status, 200); assert.ok(cookieDe(r));
      r = await post(sur('freyja'), '/api/account/login', { email: 'moussa@exemple.yt', password: MDP_MOUSSA }); assert.equal(r.status, 200);
      const m = cookieDe(r); assert.match(m, /^odin_session=[A-Za-z0-9_-]{43}$/);
      assert.match(await (await fetch(`${sur('freyja')}/`, { headers: { cookie: m } })).text(), /data-direct="app=freyja"/, 'Moussa arrive sur Vénus');
      r = await post(sur('freyja'), '/api/account/login', { email: 'moussa', password: 'pas-le-bon' }); assert.equal(r.status, 401); assert.equal(cookieDe(r), '');
      r = await post(sur('garmr'), '/api/account/login', { email: 'moussa@exemple.yt', password: MDP_MOUSSA });
      assert.equal(r.status, 403); assert.equal(cookieDe(r), '', 'pas de session sans le droit');
      const b = await r.json() as { refuse: boolean; error: string; accueil: string };
      assert.equal(b.refuse, true); assert.match(b.error, /Tu n'as pas accès à Cerbère/); assert.equal(b.accueil, accueilCerbere, 'retour à l\'écran de connexion d\'Odin, sur son port à lui');
      r = await post(v.url, '/api/account/login', { email: 'moussa@exemple.yt', password: MDP_MOUSSA }); assert.equal(r.status, 200, 'sur l\'interface d\'Odin, Moussa entre avec ses droits de membre');
    });

    await t.test('déjà connecté sans le droit : la page du port renvoie à l\'écran de connexion d\'Odin et ferme la session', async () => {
      const m = cookieDe(await post(v.url, '/api/account/login', { email: 'moussa@exemple.yt', password: MDP_MOUSSA }));
      const api = await fetch(`${sur('garmr')}/api/valhalla/view?id=garmr`, { headers: { cookie: m } }); assert.equal(api.status, 403);
      assert.equal(((await api.json()) as { accueil: string }).accueil, accueilCerbere);
      const page = await fetch(`${sur('garmr')}/`, { headers: { cookie: m }, redirect: 'manual' });
      assert.equal(page.status, 303); assert.equal(page.headers.get('location'), accueilCerbere);
      assert.match(page.headers.getSetCookie().join(';'), /odin_session=;.*Max-Age=0/);
      assert.equal((await fetch(`${v.url}/api/valhalla/catalog`, { headers: { cookie: m } })).status, 401, 'la session est fermée');
    });

    await t.test('QR code : le téléphone connecté autorise, l\'écran entre au nom de cette personne, avec ses droits', async () => {
      const ecran = async (appli: string) => (await (await post(sur(appli), '/api/connexion-qr/debut', {})).json()) as { ok: boolean; secret: string; code: string; url: string; svg: string };
      const etat = (appli: string, secret: string) => post(sur(appli), '/api/connexion-qr/etat', {}, { 'x-qr': secret });
      const tel = (cookie: string, path: string, body: unknown) => post(v.url, path, body, { cookie });
      // Le propriétaire autorise l'écran de Cerbère.
      let e = await ecran('garmr'); assert.equal(e.ok, true); assert.match(e.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.match(e.svg, /^<svg/);
      const code = e.code.replace('-', ''); const lien = new URL(e.url); assert.deepEqual([lien.port, lien.pathname, lien.search], [String(v.port), '/connexion-qr', `?c=${code}`], 'le QR code mène à l\'interface d\'Odin (adresse vue du téléphone), pas au port de l\'appli');
      assert.equal(((await (await etat('garmr', e.secret)).json()) as { etat: string }).etat, 'attente');
      assert.equal((await tel('', '/api/connexion-qr/voir', { c: code })).status, 401, 'un téléphone non connecté ne peut rien autoriser');
      const vu = (await (await tel(v.session, '/api/connexion-qr/voir', { c: code })).json()) as { ok: boolean; qui: string; demande: { appli: string; etat: string } };
      assert.deepEqual([vu.ok, vu.qui, vu.demande.appli, vu.demande.etat], [true, 'Awa', 'Cerbère', 'attente']);
      assert.equal(((await (await tel(v.session, '/api/connexion-qr/decider', { c: code, ok: true })).json()) as { ok: boolean }).ok, true);
      let r = await etat('garmr', e.secret); assert.equal(r.status, 200); const s = cookieDe(r); assert.ok(s, 'session ouverte sur l\'écran');
      assert.equal((await fetch(`${sur('garmr')}/api/valhalla/view?id=garmr`, { headers: { cookie: s } })).status, 200);
      assert.equal(((await (await etat('garmr', e.secret)).json()) as { etat: string }).etat, 'expire', 'une seule entrée par QR code');
      // Moussa autorise l'écran de Cerbère : refusé (pas son droit), retour à la connexion d'Odin.
      const m = cookieDe(await post(v.url, '/api/account/login', { email: 'moussa@exemple.yt', password: MDP_MOUSSA }));
      e = await ecran('garmr'); await tel(m, '/api/connexion-qr/decider', { c: e.code, ok: true });
      r = await etat('garmr', e.secret); assert.equal(r.status, 403); assert.equal(cookieDe(r), '');
      assert.equal(((await r.json()) as { accueil: string }).accueil, accueilCerbere);
      // … et l'écran de Vénus : il entre, comme membre.
      e = await ecran('freyja'); await tel(m, '/api/connexion-qr/decider', { c: e.code, ok: true });
      r = await etat('freyja', e.secret); assert.equal(r.status, 200); const sm = cookieDe(r);
      assert.equal(((await (await fetch(`${sur('freyja')}/api/state`, { headers: { cookie: sm } })).json()) as { membre: { login: string } }).membre.login, 'moussa');
      // Refusé sur le téléphone : l'écran reste fermé.
      e = await ecran('freyja'); await tel(v.session, '/api/connexion-qr/decider', { c: e.code, ok: false });
      r = await etat('freyja', e.secret); assert.equal(((await r.json()) as { etat: string }).etat, 'refus'); assert.equal(cookieDe(r), '');
      // Sans l'en-tête de la page d'Odin : rien.
      assert.equal((await fetch(`${sur('freyja')}/api/connexion-qr/debut`, { method: 'POST' })).status, 403);
    });
  } finally { console.log = orig; await tt.end(); }
});
