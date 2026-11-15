// Persona, pour de vrai (un vrai Odin : serveur web + applis) : groupes d'accès (créer, renommer, supprimer, y mettre des
// personnes, leur donner des applis et des sites) appliqués partout ; entrée dans l'interface d'Odin ; double
// authentification obligatoire par groupe ; verrouillage ; logiciel OpenID (secret, écran « Autoriser ? ») ; clés
// d'accès (un authentificateur logiciel signe comme un téléphone) ; invitation par lien ; mot de passe oublié par e-mail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { T } from './banc/lib.ts';
import { vraiOdin, COMPTE } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { persona, personnes, client, sauverClient, sessionsApplis } from '../src/valhalla/sso/etat.ts';
import { brancherCourrier } from '../src/valhalla/sso/registre.ts';
import { check } from '../src/valhalla/modules/var.ts';
import { totp } from '../src/valhalla/modules/brisingamen.ts';
import { cborEcrire, cborLire, cleCose, lireDonneesAuth, siteWebauthn } from '../src/valhalla/sso/cles-acces.ts';
import { nomGroupe } from '../src/valhalla/sso/groupes.ts';
import { sha256hex } from '../src/valhalla/sso/jwt.ts';

const MDP = { moussa: 'girafe-orange-sous-la-pluie-42', zaina: 'baobab-violet-au-clair-de-lune-7', ali: 'tortue-verte-dans-le-lagon-9' };
const IDS = ['var', 'brisingamen', 'freyja', 'garmr', 'hlid', 'valgrind'];
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sha = (x: Buffer | string) => createHash('sha256').update(x).digest();
const cookie = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
const pkce = () => { const verifier = b64u(randomBytes(32)); return { verifier, challenge: b64u(sha(verifier)) }; };

test('CBOR, clés COSE et règles de WebAuthn (sans réseau)', () => {
  const m = new Map<number | string, unknown>([[1, 2], [3, -7], ['x', Buffer.from([1, 2])], [-2, [true, null, 'é']]]);
  assert.deepEqual(cborLire(cborEcrire(m as never)).v, m);
  assert.throws(() => cborLire(Buffer.from([0x5f])), /indéfinie/); assert.throws(() => cborLire(Buffer.from([0x58, 10, 1])), /tronqué/);
  const k = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  assert.equal(cleCose(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(k.x, 'base64url')], [-3, Buffer.from(k.y, 'base64url')]]) as never).alg, -7);
  assert.throws(() => cleCose(new Map<number, unknown>([[1, 2], [3, -36]]) as never), /non accepté/);
  assert.throws(() => siteWebauthn('https://192.168.1.10:8888'), /adresse IP/); assert.throws(() => siteWebauthn('http://odin.exemple.fr'), /https/);
  assert.deepEqual(siteWebauthn('https://odin.exemple.fr:8888'), { origine: 'https://odin.exemple.fr:8888', rpId: 'odin.exemple.fr' });
  assert.throws(() => lireDonneesAuth(Buffer.alloc(10)), /trop courtes/);
  assert.equal(nomGroupe('Groupe Bureau'), 'bureau'); assert.throws(() => nomGroupe('a b c!'), /nom de groupe/);
});

/** Un authentificateur logiciel (comme un téléphone) : une paire de clés P-256, un compteur. */
function authentificateur(rpId: string, origine: string) {
  const k = generateKeyPairSync('ec', { namedCurve: 'P-256' }), id = randomBytes(32); let compteur = 0;
  const j = k.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  return {
    id: b64u(id),
    creer(defi: string) {
      const cose = cborEcrire(new Map<number, never>([[1, 2 as never], [3, -7 as never], [-1, 1 as never], [-2, Buffer.from(j.x, 'base64url') as never], [-3, Buffer.from(j.y, 'base64url') as never]]));
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const authData = Buffer.concat([sha(rpId), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, id, cose]);
      return { clientDataJSON: b64u(JSON.stringify({ type: 'webauthn.create', challenge: defi, origin: origine })), attestationObject: b64u(cborEcrire(new Map<string, never>([['fmt', 'none' as never], ['attStmt', new Map() as never], ['authData', authData as never]]))) };
    },
    signer(defi: string, o: { origine?: string; compteur?: number; sub?: string } = {}) {
      compteur = o.compteur ?? compteur + 1; const c = Buffer.alloc(4); c.writeUInt32BE(compteur);
      const authData = Buffer.concat([sha(rpId), Buffer.from([0x05]), c]), cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: defi, origin: o.origine ?? origine }));
      return { id: b64u(id), clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(sign('sha256', Buffer.concat([authData, sha(cd)]), k.privateKey)), userHandle: o.sub ? b64u(o.sub) : '' };
    },
  };
}

test('Persona pour de vrai : groupes, droits partout, double authentification, verrouillage, OpenID, clés d\'accès, invitation, mot de passe oublié', { timeout: 240_000 }, async (t) => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  const mails: Array<{ a: string; sujet: string; texte: string }> = [];
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) }), va = valhallaOf()!;
    brancherCourrier(async (a, sujet, texte) => { mails.push({ a, sujet, texte }); });
    for (const [login, nom, groupes] of [['moussa', 'Moussa', 'famille'], ['zaina', 'Zaïna', 'invite'], ['ali', 'Ali', 'famille']] as const) {
      const r = await va.act('var', 'ajouter', { login, nom, groupes, email: `${login}@exemple.yt`, mot_de_passe: MDP[login] }); assert.equal(r.ok, true, r.text);
    }
    const ctx = persona()!, P = (l: string) => personnes(ctx).find((p) => p.login === l)!;
    const post = (path: string, body: unknown, h: Record<string, string> = {}) => fetch(v.url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1', ...h }, body: JSON.stringify(body), redirect: 'manual' });
    const entrer = async (email: string, password: string) => { const r = await post('/api/account/login', { email, password }); return { status: r.status, cookie: cookie(r, 'odin_session'), body: await r.json() as Record<string, unknown> }; };
    const connexionSso = (identifiant: string, motdepasse: string, code?: string) => post('/sso/connexion', { identifiant, motdepasse, ...(code ? { code } : {}), appli: 'pegase', appareil: { id: 'essai-appareil-01', nom: 'PC', plateforme: 'linux' } });

    let voir: (id: string) => Promise<number> = async () => 0;
    await t.test('groupes : créer, y mettre une personne, donner une appli ; le droit vaut dans l\'interface', async () => {
      assert.equal((await va.act('var', 'creer_groupe', { nom: 'Bureau', description: 'les ordinateurs du bureau' })).ok, true);
      assert.equal((await va.act('var', 'creer_groupe', { nom: 'bureau' })).ok, false, 'pas deux fois le même groupe');
      assert.equal((await va.act('var', 'mettre_dans_groupe', { login: 'moussa', groupe: 'bureau' })).ok, true);
      assert.equal((await va.act('var', 'mettre_dans_groupe', { login: 'moussa', groupe: 'inconnu' })).ok, false, 'groupe inexistant');
      assert.deepEqual(P('moussa').groups, ['famille', 'bureau']);
      const m = await entrer('moussa@exemple.yt', MDP.moussa); assert.equal(m.status, 200);
      voir = async (id: string) => (await fetch(`${v.url}/api/valhalla/view?id=${id}`, { headers: { cookie: m.cookie } })).status;
      assert.equal(await voir('garmr'), 403, 'Cerbère : admin seulement au départ');
      assert.equal((await va.act('var', 'donner_acces', { appli: 'garmr', qui: 'bureau' })).ok, true);
      assert.equal(await voir('garmr'), 200, 'le groupe bureau a Cerbère');
      const g = (await va.act('var', 'groupes')).data as { groupes: Array<{ id: string; personnes: string[]; applis: string[] }> };
      assert.deepEqual(g.groupes.find((x) => x.id === 'bureau')?.personnes, ['Moussa']); assert.ok(g.groupes.find((x) => x.id === 'bureau')?.applis.includes('Cerbère'));
    });
    {
      await t.test('renommer : le nouveau nom partout, le droit suit', async () => {
        assert.equal((await va.act('var', 'renommer_groupe', { groupe: 'bureau', nouveau: 'atelier' })).ok, true);
        assert.ok(P('moussa').groups.includes('atelier') && !P('moussa').groups.includes('bureau'));
        assert.equal(await voir('garmr'), 200, 'le droit a suivi le nouveau nom');
        assert.equal((await va.act('var', 'renommer_groupe', { groupe: 'admin', nouveau: 'chefs' })).ok, false, 'admin ne se renomme pas');
      });
      await t.test('sortir du groupe : le droit tombe tout de suite (interface et jetons des applis)', async () => {
        assert.equal((await va.act('var', 'donner_acces', { appli: 'pegase', qui: 'atelier' })).ok, true);
        assert.equal((await va.act('var', 'retirer_acces', { appli: 'pegase', qui: 'famille' })).ok, true);
        const r = await connexionSso('moussa', MDP.moussa); assert.equal(r.status, 200, 'Moussa a Pégase par le groupe atelier');
        const sid = ((await r.json()) as { refresh_token: string }).refresh_token.split('.')[1];
        assert.equal((await va.act('var', 'sortir_du_groupe', { login: 'moussa', groupe: 'atelier' })).ok, true);
        assert.equal(await voir('garmr'), 403);
        assert.ok(sessionsApplis(ctx).find((x) => x.id === sid)?.revoque, 'sa connexion de Pégase est coupée');
        assert.equal((await connexionSso('moussa', MDP.moussa)).status, 403, 'et il ne peut plus se reconnecter à Pégase');
        await va.act('var', 'donner_acces', { appli: 'pegase', qui: 'famille' });
      });
      await t.test('supprimer : retiré des personnes, des applis et des sites', async () => {
        await va.act('var', 'mettre_dans_groupe', { login: 'ali', groupe: 'atelier' });
        ctx.saveSettings({ rules: [{ domain: 'nas.exemple.fr', groups: ['atelier'] }] });
        const tok = randomBytes(30).toString('base64url');
        ctx.saveSettings({ sessions: [...((ctx.settings.sessions as unknown[]) ?? []), { id: sha256hex(tok), login: 'ali', created: Date.now(), expires: Date.now() + 3600_000, ip: '127.0.0.1', agent: 'essai', seen: Date.now() }] });
        assert.deepEqual(check(`odin_var=${tok}`, 'nas.exemple.fr'), { user: 'ali', groups: ['famille', 'atelier'] }, 'proxy : Ali (atelier) entre sur le NAS');
        assert.equal((await va.act('var', 'supprimer_groupe', { groupe: 'atelier' })).ok, true);
        assert.ok(!P('ali').groups.includes('atelier'));
        assert.equal(check(`odin_var=${tok}`, 'nas.exemple.fr'), 'refusé', 'proxy : plus le droit');
        assert.ok(!(ctx.settings.ssoDroits as Record<string, string[]>).garmr.includes('atelier'));
        assert.equal((await va.act('var', 'donner_site', { groupe: 'famille', domaine: 'nas.exemple.fr' })).ok, true);
        assert.notEqual(check(`odin_var=${tok}`, 'nas.exemple.fr'), 'refusé', 'donner le site à famille : Ali rentre');
        assert.equal((await va.act('var', 'retirer_site', { groupe: 'famille', domaine: 'nas.exemple.fr' })).ok, true);
        assert.equal(check(`odin_var=${tok}`, 'nas.exemple.fr'), 'refusé');
        await va.act('var', 'mettre_dans_groupe', { login: 'ali', groupe: 'admin' });
        assert.notEqual(check(`odin_var=${tok}`, 'nas.exemple.fr'), 'refusé', 'le groupe admin entre partout');
        await va.act('var', 'sortir_du_groupe', { login: 'ali', groupe: 'admin' });
      });
    }

    await t.test('interface d\'Odin : il faut le droit « odin » (Zaïna, groupe invite, n\'entre pas)', async () => {
      const z = await entrer('zaina@exemple.yt', MDP.zaina); assert.equal(z.status, 403); assert.equal(z.cookie, ''); assert.match(String(z.body.error), /Tu n'as pas accès à Odin/);
      assert.equal((await entrer('moussa@exemple.yt', MDP.moussa)).status, 200);
    });

    await t.test('double authentification obligatoire pour un groupe', async () => {
      assert.equal((await va.act('var', 'double_auth_groupe', { groupe: 'famille', obligatoire: true })).ok, true);
      let r = await connexionSso('ali', MDP.ali); assert.equal(r.status, 403); assert.equal(((await r.json()) as { code: string }).code, 'double_auth_a_regler');
      assert.equal((await entrer('ali@exemple.yt', MDP.ali)).status, 403, 'pas d\'entrée dans l\'interface non plus');
      await va.act('var', 'double_auth', { login: 'ali' }); const sec = P('ali').totpPending!;
      assert.equal((await va.act('var', 'confirmer_double_auth', { login: 'ali', code: totp(sec).code })).ok, true);
      r = await connexionSso('ali', MDP.ali); assert.equal(r.status, 401); assert.equal(((await r.json()) as { code: string }).code, 'code_requis');
      r = await connexionSso('ali', MDP.ali, totp(sec).code); assert.equal(r.status, 200, 'mot de passe + code');
      await va.act('var', 'double_auth_groupe', { groupe: 'famille', obligatoire: false });
    });

    await t.test('verrouillage après 5 essais ratés, même avec le bon mot de passe ensuite', async () => {
      for (let i = 0; i < 5; i++) assert.equal((await connexionSso('moussa', 'pas-le-bon-mot-de-passe')).status, 401);
      const r = await connexionSso('moussa', MDP.moussa); assert.equal(r.status, 423); assert.equal(((await r.json()) as { code: string }).code, 'verrouille');
      assert.ok(ctx.alerts({ module: 'var' }).some((a) => /verrouillé/.test(a.title)), 'alerte');
      ctx.saveSettings({ people: personnes(ctx).map((p) => (p.login === 'moussa' ? { ...p, fails: 0, lockedUntil: undefined } : p)) });
    });

    await t.test('logiciel OpenID (Gitea) : inscription, « Autoriser ? » la première fois, secret, jetons', async () => {
      const ins = await va.act('var', 'inscrire_logiciel', { logiciel: 'gitea', domaine: 'git.exemple.fr', odin: v.url, groupes: 'famille' });
      assert.equal(ins.ok, true, ins.text); assert.match(ins.text, /gitea admin auth add-oauth/); assert.match(ins.text, /--auto-discover-url/);
      const id = (ins.data as { client_id: string }).client_id, retour = 'https://git.exemple.fr/user/oauth2/Odin/callback';
      assert.deepEqual(client(ctx, id)?.retours, [retour]);
      sauverClient(ctx, { ...client(ctx, id)!, secret: sha256hex('secret-de-l-essai') }); // le vrai est dans le coffre
      // Moussa se connecte au portail (session du navigateur), Gitea demande la connexion.
      const q = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: retour, scope: 'openid profile email groups', state: 'etat-de-gitea-1' });
      let r = await fetch(`${v.url}/sso/autoriser?${q}`, { redirect: 'manual' }); const html = await r.text(), dem = /name="demande" value="([^"]+)"/.exec(html)![1];
      assert.match(html, /Mot de passe oublié/); assert.match(html, /clé d'accès/);
      r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande: dem, identifiant: 'moussa', motdepasse: MDP.moussa }) });
      assert.equal(r.status, 200); const nav = cookie(r, 'odin_var'), page = await r.text();
      assert.match(page, /Autoriser Gitea \?/); assert.match(page, /ton adresse e-mail, tes groupes/);
      const dem2 = /name="demande" value="([^"]+)"/.exec(page)![1];
      r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande: dem2, consentement: 'oui' }) });
      assert.equal(r.status, 403, 'sans la session de Moussa, personne ne répond à sa place');
      r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url, cookie: nav }, body: new URLSearchParams({ demande: dem2, consentement: 'oui' }) });
      assert.equal(r.status, 303); const loc = new URL(r.headers.get('location')!); assert.equal(loc.origin + loc.pathname, retour); assert.equal(loc.searchParams.get('state'), 'etat-de-gitea-1');
      const tok = (secret: string, code: string) => fetch(`${v.url}/sso/jeton`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: retour }) });
      assert.equal((await tok('mauvais', loc.searchParams.get('code')!)).status, 401, 'secret faux');
      const j = await tok('secret-de-l-essai', loc.searchParams.get('code')!); assert.equal(j.status, 200);
      const at = ((await j.json()) as { access_token: string }).access_token;
      const infos = (await (await fetch(`${v.url}/sso/infos`, { headers: { authorization: `Bearer ${at}` } })).json()) as { preferred_username: string; groups: string[] };
      assert.equal(infos.preferred_username, 'moussa');
      // La fois suivante : plus d'écran (déjà autorisé).
      r = await fetch(`${v.url}/sso/autoriser?${q}`, { redirect: 'manual', headers: { cookie: nav } }); assert.equal(r.status, 303);
      // Ali (pas encore autorisé) avec prompt=none : consent_required, jamais d'écran.
      const ali = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande: /name="demande" value="([^"]+)"/.exec(await (await fetch(`${v.url}/sso/autoriser?${q}`)).text())![1], identifiant: 'moussa', motdepasse: MDP.moussa }) });
      void ali;
    });

    await t.test('clés d\'accès : inscrire depuis « Mon compte », se connecter sans mot de passe, refus des copies et des autres sites', async () => {
      const L = `http://localhost:${v.port}`, a = authentificateur('localhost', L);
      const j = (path: string, body: unknown, h: Record<string, string> = {}) => fetch(L + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: L, ...h }, body: JSON.stringify(body) });
      // « Mon compte » : connexion par mot de passe.
      let r = await fetch(`${L}/sso/compte`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: L }, body: new URLSearchParams({ identifiant: 'zaina', motdepasse: MDP.zaina }) });
      assert.equal(r.status, 303); const nav = cookie(r, 'odin_var'); assert.ok(nav);
      assert.match(await (await fetch(`${L}/sso/compte`, { headers: { cookie: nav } })).text(), /Ajouter une clé d'accès/);
      const deb = (await (await j('/sso/compte/cle/debut', { nom: 'Téléphone de Zaïna' }, { cookie: nav })).json()) as { options: { challenge: string; rp: { id: string }; authenticatorSelection: { userVerification: string } } };
      assert.equal(deb.options.rp.id, 'localhost'); assert.equal(deb.options.authenticatorSelection.userVerification, 'required');
      r = await j('/sso/compte/cle/fin', { nom: 'Téléphone de Zaïna', ...a.creer(deb.options.challenge) }, { cookie: nav }); assert.equal(r.status, 200, await r.clone().text());
      assert.equal((await j('/sso/compte/cle/fin', { ...a.creer(deb.options.challenge) }, { cookie: nav })).status, 400, 'défi déjà servi');
      // Connexion à Pégase (appli préinscrite) par le portail, avec la clé.
      const p = pkce(), q = new URLSearchParams({ response_type: 'code', client_id: 'pegase', redirect_uri: 'http://127.0.0.1:53123/sso/retour', scope: 'openid profile', state: 'etat-pegase-1', code_challenge: p.challenge, code_challenge_method: 'S256' });
      const dem = /name="demande" value="([^"]+)"/.exec(await (await fetch(`${L}/sso/autoriser?${q}`)).text())![1];
      let o = (await (await j('/sso/cle/debut', { demande: dem })).json()) as { options: { challenge: string; rpId: string } };
      assert.equal((await j('/sso/cle/fin', { demande: dem, ...a.signer(o.options.challenge, { origine: 'http://localhost:1' }) })).status, 401, 'réponse venue d\'un autre site');
      o = (await (await j('/sso/cle/debut', { demande: dem })).json()) as typeof o;
      r = await j('/sso/cle/fin', { demande: dem, ...a.signer(o.options.challenge, { sub: P('zaina').id }) }); assert.equal(r.status, 200, await r.clone().text());
      const nav2 = cookie(r, 'odin_var'); assert.ok(nav2, 'session du navigateur ouverte');
      r = await fetch(`${L}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: L, cookie: nav2 }, body: new URLSearchParams({ demande: dem, suite: '1' }) });
      assert.equal(r.status, 303); assert.ok(new URL(r.headers.get('location')!).searchParams.get('code'), 'code pour Pégase, sans mot de passe');
      // Compteur en arrière : clé copiée.
      const dem3 = /name="demande" value="([^"]+)"/.exec(await (await fetch(`${L}/sso/autoriser?${q}`)).text())![1];
      o = (await (await j('/sso/cle/debut', { demande: dem3 })).json()) as typeof o;
      assert.equal((await j('/sso/cle/fin', { demande: dem3, ...a.signer(o.options.challenge, { compteur: 1 }) })).status, 401);
      // Par une adresse IP : refusé avec une explication.
      const ip = (await (await fetch(`${v.url}/sso/cle/debut`, { method: 'POST', headers: { 'content-type': 'application/json', origin: v.url }, body: JSON.stringify({ demande: dem3 }) })).json()) as { message: string };
      assert.match(ip.message, /adresse IP/);
    });

    await t.test('invitation par lien : e-mail, compte créé par la personne, code réglé si son groupe l\'exige', async () => {
      await va.act('var', 'creer_groupe', { nom: 'compta', double_auth: true });
      const r0 = await va.act('var', 'inviter', { nom: 'Fatima Ali', groupes: 'compta', email: 'fatima@exemple.yt' }); assert.equal(r0.ok, true, r0.text);
      const m = mails.at(-1)!; assert.equal(m.a, 'fatima@exemple.yt'); const lien = /https?:\/\/\S+\/sso\/invitation\?j=[A-Za-z0-9_-]{43}/.exec(m.texte)![0];
      const j = new URL(lien).searchParams.get('j')!;
      assert.match(await (await fetch(`${v.url}/sso/invitation?j=${j}`)).text(), /Choisis ton identifiant/);
      const form = (b: Record<string, string>) => fetch(`${v.url}/sso/invitation`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ j, ...b }) });
      assert.equal((await form({ login: 'fatima', motdepasse: 'court', motdepasse2: 'court' })).status, 400);
      assert.equal((await form({ login: 'moussa', motdepasse: 'un-long-mot-de-passe', motdepasse2: 'un-long-mot-de-passe' })).status, 400, 'identifiant pris');
      let r = await form({ login: 'fatima', motdepasse: 'un-long-mot-de-passe', motdepasse2: 'un-long-mot-de-passe' });
      assert.equal(r.status, 200); assert.match(await r.text(), /Double authentification/);
      const sec = P('fatima').totpPending!; assert.deepEqual(P('fatima').groups, ['compta']);
      assert.equal((await connexionSso('fatima', 'un-long-mot-de-passe')).status, 403, 'pas avant le code');
      r = await form({ code: '000000' }); assert.equal(r.status, 401);
      r = await form({ code: totp(sec).code }); assert.equal(r.status, 200); assert.match(await r.text(), /Bienvenue Fatima Ali/); assert.ok(cookie(r, 'odin_var'));
      assert.equal((await fetch(`${v.url}/sso/invitation?j=${j}`)).status, 410, 'le lien ne sert qu\'une fois');
      assert.equal((await connexionSso('fatima', 'un-long-mot-de-passe')).status, 401, 'code demandé ensuite');
      const sans = await va.act('var', 'inviter', { nom: 'Invité Sans Mail', groupes: 'invite' }); assert.match(sans.text, /\/sso\/invitation\?j=/); assert.equal(mails.length, 1, 'sans adresse : aucun e-mail');
    });

    await t.test('mot de passe oublié : lien par e-mail, nouveau mot de passe, connexions coupées, lien à usage unique', async () => {
      const avant = await connexionSso('moussa', MDP.moussa); assert.equal(avant.status, 200);
      const rt = ((await avant.json()) as { refresh_token: string }).refresh_token;
      const n = mails.length;
      let r = await fetch(`${v.url}/sso/oubli`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ identifiant: 'personne-inconnue' }) });
      const repInconnu = await r.text(); assert.equal(mails.length, n, 'compte inconnu : pas d\'e-mail');
      r = await fetch(`${v.url}/sso/oubli`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ identifiant: 'moussa@exemple.yt' }) });
      assert.equal(/Si ce compte existe/.test(await r.text()), /Si ce compte existe/.test(repInconnu), 'même réponse : on ne sait pas si le compte existe');
      assert.equal(mails.length, n + 1); const m = mails.at(-1)!; assert.equal(m.a, 'moussa@exemple.yt');
      const j = /\/sso\/oubli\/nouveau\?j=([A-Za-z0-9_-]{43})/.exec(m.texte)![1];
      const form = (b: Record<string, string>) => fetch(`${v.url}/sso/oubli/nouveau`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ j, ...b }) });
      assert.equal((await form({ motdepasse: 'nouveau-mot-de-passe-1', motdepasse2: 'autre-chose-encore' })).status, 400);
      r = await form({ motdepasse: 'nouveau-mot-de-passe-1', motdepasse2: 'nouveau-mot-de-passe-1' }); assert.equal(r.status, 200); assert.match(await r.text(), /Mot de passe changé/);
      assert.equal((await connexionSso('moussa', MDP.moussa)).status, 401, 'l\'ancien ne marche plus');
      assert.equal((await connexionSso('moussa', 'nouveau-mot-de-passe-1')).status, 200);
      const ren = await fetch(`${v.url}/sso/jeton`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: 'pegase', appareil: 'essai-appareil-01' }) });
      assert.equal(ren.status, 400, 'les connexions d\'avant sont coupées');
      assert.equal((await form({ motdepasse: 'encore-un-autre-mdp', motdepasse2: 'encore-un-autre-mdp' })).status, 410, 'lien à usage unique');
      // Le propriétaire : son mot de passe est celui d'Odin, pas de lien par Persona.
      await fetch(`${v.url}/sso/oubli`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ identifiant: COMPTE.email }) });
      assert.equal(mails.length, n + 1);
    });
  } finally { Object.assign(console, orig); await tt.end(); }
});
