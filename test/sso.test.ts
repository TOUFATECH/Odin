// Connexion unique d'Odin, pour de vrai : un vrai Odin (serveur web + applis), la vraie bibliothèque cliente
// (clients/odin-sso.mjs), de vrais échanges HTTP. Seul le coffre du système est remplacé (pas de Secret Service ici).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, freePort } from './banc/lib.ts';
import { vraiOdin, COMPTE, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { aGarder, type Version } from '../src/valhalla/sso/sauvegardes.ts';
import { retourPermis } from '../src/valhalla/sso/etat.ts';
// @ts-expect-error bibliothèque JavaScript sans types (copiée telle quelle dans Pégase et Vénus)
import { OdinSSO, coffre as coffreSysteme, verifierJwt, requete } from '../clients/odin-sso.mjs';

const MDP_MOUSSA = 'girafe-orange-sous-la-pluie-42', MDP_ZAINA = 'baobab-violet-au-clair-de-lune-7';
const IDS = ['var', 'brisingamen', 'freyja', 'garmr', 'fjalar', 'valgrind', 'hlid'];
/** Un coffre du système en mémoire (même interface que celui de la bibliothèque). */
const fauxCoffre = () => { const m = new Map<string, string>(); return { m, disponible: async () => true, ranger: async (n: string, s: string) => { m.set(n, s); }, lire: async (n: string) => m.get(n), effacer: async (n: string) => { m.delete(n); } }; };
/** Un faux « ufw » et un faux « nft » (le port direct de l'essai ne touche pas au pare-feu de la machine). */
function fauxPareFeu(tt: T): void {
  const dir = tt.tmp('faux-pare-feu-');
  writeFileSync(join(dir, 'ufw'), '#!/bin/sh\nif [ "$1" = status ]; then echo "Status: active"; fi\nexit 0\n', { mode: 0o755 }); writeFileSync(join(dir, 'nft'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const avant = process.env.PATH; process.env.PATH = `${dir}:${avant}`; tt.onEnd(() => { process.env.PATH = avant; });
}
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';

/** Le navigateur de l'essai : suit la page de connexion d'Odin (formulaire Persona), puis l'adresse de retour. */
function navigateur(v: VraiOdin, ident: string, mdp: string, o: { cookie?: string; changer?: (loc: string) => string; vu?: string[] } = {}) {
  return async (url: string) => {
    let r = await fetch(url, { redirect: 'manual', headers: o.cookie ? { cookie: o.cookie } : {} });
    if (r.status === 200) {
      const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)?.[1]; assert.ok(demande, 'formulaire de connexion de Persona');
      assert.match(html, /te demande de te connecter avec ton compte Odin/);
      r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
    }
    assert.equal(r.status, 303, `renvoi vers l'appli (obtenu ${r.status})`);
    let loc = r.headers.get('location')!; o.vu?.push(loc); if (o.changer) loc = o.changer(loc);
    await (await fetch(loc)).text();
  };
}
/** Tous les fichiers du dossier d'Odin contiennent-ils ce texte ? (le mot de passe ne doit être nulle part) */
function partout(dir: string, texte: string): string[] {
  const out: string[] = [], b = Buffer.from(texte);
  const voir = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) voir(f); else if (e.isFile() && statSync(f).size < 20e6 && readFileSync(f).includes(b)) out.push(f); } };
  voir(dir); return out;
}

test('aGarder : 48 h, une par jour, une par mois, la dernière complète toujours', () => {
  const H = 3600_000, now = Date.UTC(2026, 10, 14, 12), v = (id: string, h: number, sorte: Version['sorte'] = 'complete'): Version => ({ id, date: now - h * H, taille: 1, empreinte: id, sorte, raison: '', nom: '', base: null, appareil: '' });
  const k = aGarder([v('a', 1), v('b', 30), v('c', 50), v('c2', 51), v('d', 24 * 40), v('e', 24 * 400), v('f', 49, 'changements')], now);
  assert.deepEqual([...k].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual([...aGarder([v('vieille', 24 * 900)], now)], ['vieille'], 'la seule complète est gardée même très vieille');
});

test('adresse de retour : exacte, ou port libre pour la machine elle-même déclarée sans port', () => {
  const c = { id: 'x', nom: 'X', retours: ['http://127.0.0.1/sso/retour', 'https://venus.exemple.fr/auth/odin/retour'] };
  assert.equal(retourPermis(c, 'http://127.0.0.1:53111/sso/retour'), true);
  assert.equal(retourPermis(c, 'http://127.0.0.1:53111/autre'), false);
  assert.equal(retourPermis(c, 'https://venus.exemple.fr/auth/odin/retour'), true);
  assert.equal(retourPermis(c, 'https://venus.exemple.fr:444/auth/odin/retour'), false);
  assert.equal(retourPermis(c, 'https://evil.exemple/auth/odin/retour'), false);
  assert.equal(retourPermis(c, 'http://127.0.0.1.evil.exemple:80/sso/retour'), false);
});

test('connexion unique d\'Odin, pour de vrai', { timeout: 240_000 }, async (t) => {
  const tt = new T(), logs: string[] = [], orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  try {
    fauxPareFeu(tt);
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) }), va = valhallaOf()!;
    for (const [login, nom, groupes, mdp] of [['moussa', 'Moussa', 'famille', MDP_MOUSSA], ['zaina', 'Zaïna', 'invite', MDP_ZAINA]]) {
      const r = await va.act('var', 'ajouter', { login, nom, groupes, email: `${login}@exemple.yt`, mot_de_passe: mdp }); assert.equal(r.ok, true, r.text);
    }
    const compteAvant = readFileSync(join(v.o.paths.home, 'compte.json'), 'utf8');

    await t.test('découverte et clés publiques', async () => {
      const d = (await v.json('/.well-known/openid-configuration')).body as Record<string, unknown>;
      assert.equal(d.issuer, v.url); assert.equal(d.authorization_endpoint, `${v.url}/sso/autoriser`); assert.deepEqual(d.code_challenge_methods_supported, ['S256']);
      assert.deepEqual(d.id_token_signing_alg_values_supported, ['ES256']); assert.equal((d.odin as { protocole: number }).protocole, 1);
      const k = (await v.json('/sso/cles')).body as { keys: Array<Record<string, string>> };
      assert.equal(k.keys.length, 1); assert.equal(k.keys[0].alg, 'ES256'); assert.equal(k.keys[0].crv, 'P-256'); assert.ok(!('d' in k.keys[0]), 'jamais la partie privée');
      assert.ok(existsSync(join(v.o.paths.home, 'valhalla', 'var', 'sso', 'cle-signature.enc')), 'clé privée rangée chiffrée');
      assert.doesNotMatch(readFileSync(join(v.o.paths.home, 'valhalla', 'var', 'sso', 'cle-signature.enc')).toString('latin1'), /BEGIN|PRIVATE/);
    });

    await t.test('flux OpenID complet avec PKCE : jeton signé vérifié avec la clé publique', async () => {
      const sso = new OdinSSO({ adresse: v.url, appli: 'venus', appareil: { id: 'appareil-essai-venus', nom: 'Vénus de l\'essai', plateforme: 'linux' }, coffre: fauxCoffre() });
      const vu: string[] = [];
      const r = await sso.autoriser({ ouvrir: navigateur(v, 'moussa', MDP_MOUSSA, { vu }) });
      assert.equal(r.ok, true, r.message); assert.equal(r.personne.preferred_username, 'moussa'); assert.deepEqual(r.personne.groups, ['famille']);
      assert.match(vu[0], /^http:\/\/127\.0\.0\.1:\d+\/sso\/retour\?code=[A-Za-z0-9_-]{43}&state=[A-Za-z0-9_-]+&iss=/);
      // Vérification indépendante de la bibliothèque : la signature ES256 avec la clé publique de /sso/cles (node:crypto seul).
      const jwks = (await v.json('/sso/cles')).body as { keys: Array<{ x: string; y: string; kid: string }> }, [h, p, s] = sso.etat.access.split('.');
      const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwks.keys[0].x, y: jwks.keys[0].y }, format: 'jwk' });
      assert.equal(verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), true, 'signature ES256 valide');
      const ch = JSON.parse(Buffer.from(p, 'base64url').toString()); assert.equal(ch.aud, 'venus'); assert.equal(ch.iss, v.url); assert.ok(ch.exp - ch.iat === 900, 'jeton d\'accès de 15 minutes');
      assert.equal(JSON.parse(Buffer.from(h, 'base64url').toString()).typ, 'at+jwt');
      const forge = `${h}.${Buffer.from(JSON.stringify({ ...ch, groups: ['admin'] })).toString('base64url')}.${s}`;
      assert.throws(() => verifierJwt(forge, jwks, {}), /signature fausse/, 'un jeton modifié est refusé');
      const infos = (await v.json('/sso/infos', undefined, { authorization: `Bearer ${sso.etat.access}` })).body as Record<string, unknown>;
      assert.equal(infos.preferred_username, 'moussa'); assert.deepEqual(infos.applis, ['pegase', 'venus'], 'famille : Pégase et Vénus');
      assert.equal((await v.json('/sso/infos', undefined, { authorization: `Bearer ${forge}` })).status, 401);
      // La session Persona de ce navigateur sert à l'appli suivante : plus d'écran.
    });

    await t.test('refus : sans PKCE, PKCE « plain », adresse de retour non déclarée, mauvais state, code réutilisé, mauvais vérificateur', async () => {
      const base = `${v.url}/sso/autoriser?response_type=code&client_id=venus&redirect_uri=${encodeURIComponent('http://127.0.0.1:9/sso/retour')}&scope=openid&state=etat-de-l-essai`;
      let r = await fetch(base, { redirect: 'manual' });
      assert.equal(r.status, 303); let loc = new URL(r.headers.get('location')!); assert.equal(loc.searchParams.get('error'), 'invalid_request'); assert.match(loc.searchParams.get('error_description')!, /PKCE obligatoire/); assert.equal(loc.searchParams.get('state'), 'etat-de-l-essai');
      r = await fetch(`${base}&code_challenge=${'a'.repeat(43)}&code_challenge_method=plain`, { redirect: 'manual' }); loc = new URL(r.headers.get('location')!); assert.equal(loc.searchParams.get('error'), 'invalid_request');
      r = await fetch(`${v.url}/sso/autoriser?response_type=code&client_id=venus&redirect_uri=${encodeURIComponent('https://pirate.exemple/vol')}&scope=openid&state=etat-de-l-essai&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256`, { redirect: 'manual' });
      assert.equal(r.status, 400); assert.equal(r.headers.get('location'), null, 'jamais de renvoi vers une adresse non déclarée'); assert.match(await r.text(), /Adresse de retour non déclarée/);
      r = await fetch(`${v.url}/sso/autoriser?response_type=code&client_id=inconnue&redirect_uri=x&scope=openid&state=etat-de-l-essai`, { redirect: 'manual' }); assert.equal(r.status, 400);
      // Mauvais state : la bibliothèque refuse la réponse.
      const sso = new OdinSSO({ adresse: v.url, appli: 'venus', appareil: { id: 'appareil-essai-state' }, coffre: fauxCoffre() });
      const x = await sso.autoriser({ ouvrir: navigateur(v, 'moussa', MDP_MOUSSA, { changer: (l) => l.replace(/state=[^&]+/, 'state=autre-etat-falsifie') }) });
      assert.equal(x.ok, false); assert.equal(x.code, 'state'); assert.equal(sso.etat, null, 'aucun jeton demandé');
      // Code réutilisé et mauvais vérificateur, à la main.
      const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url'), redirect = 'http://127.0.0.1:9/sso/retour';
      const obtenir = async () => { const vu: string[] = []; await navigateur(v, 'moussa', MDP_MOUSSA, { vu }).call(null, `${v.url}/sso/autoriser?response_type=code&client_id=venus&redirect_uri=${encodeURIComponent(redirect)}&scope=openid&state=etat-de-l-essai&code_challenge=${challenge}&code_challenge_method=S256`).catch(() => undefined); return new URL(vu[0]).searchParams.get('code')!; };
      const jet = (code: string, ver: string) => fetch(`${v.url}/sso/jeton`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: 'venus', code_verifier: ver }) });
      let code = await obtenir();
      let j = await jet(code, randomBytes(32).toString('base64url')); assert.equal(j.status, 400); assert.equal((await j.json() as Record<string, string>).error, 'invalid_grant');
      code = await obtenir(); j = await jet(code, verifier); assert.equal(j.status, 200);
      const tok = await j.json() as { access_token: string };
      j = await jet(code, verifier); assert.equal(j.status, 400); assert.match((await j.json() as Record<string, string>).message, /déjà servi/);
      assert.equal((await v.json('/sso/infos', undefined, { authorization: `Bearer ${tok.access_token}` })).status, 401, 'le code rejoué coupe la session qu\'il avait ouverte');
    });

    await t.test('droits : accès, ou refus avec le message en français', async () => {
      const ok = (await v.json('/sso/connexion', { identifiant: 'moussa@exemple.yt', motdepasse: MDP_MOUSSA, appli: 'venus', appareil: { id: 'appareil-essai-droits', nom: 'PC', plateforme: 'windows' } })).body;
      assert.equal(ok.ok, true); assert.equal((ok.personne as { name: string }).name, 'Moussa');
      const non = await v.json('/sso/connexion', { identifiant: 'zaina', motdepasse: MDP_ZAINA, appli: 'venus', appareil: { id: 'appareil-essai-droits', nom: 'PC', plateforme: 'windows' } });
      assert.equal(non.status, 403); assert.equal(non.body.code, 'refuse'); assert.equal(non.body.message, 'Tu n\'as pas accès à Vénus. Demande à Awa de t\'ajouter au groupe famille.');
      // Par le navigateur : l'appli reçoit access_denied et le même message.
      const sso = new OdinSSO({ adresse: v.url, appli: 'venus', appareil: { id: 'appareil-essai-droits2' }, coffre: fauxCoffre() });
      const r = await sso.autoriser({ ouvrir: navigateur(v, 'zaina', MDP_ZAINA), prompt: 'login' });
      assert.equal(r.ok, false); assert.equal(r.code, 'access_denied'); assert.equal(r.message, 'Tu n\'as pas accès à Vénus. Demande à Awa de t\'ajouter au groupe famille.');
      const faux = await v.json('/sso/connexion', { identifiant: 'zaina', motdepasse: 'mauvais-mot-de-passe-x', appli: 'pegase', appareil: { id: 'appareil-essai-droits' } });
      assert.equal(faux.status, 401); assert.equal(faux.body.message, 'Identifiant ou mot de passe incorrect.');
      const j = (await va.act('var', 'journal')).text; assert.match(j, /zaina .*SSO Vénus · pas le droit/); assert.match(j, /moussa .*SSO Vénus · mot de passe/);
      // Le propriétaire se connecte avec le mot de passe de son compte d'Odin (personne « proprietaire », groupe admin).
      const pro = (await v.json('/sso/connexion', { identifiant: COMPTE.email, motdepasse: COMPTE.password, appli: 'venus', appareil: { id: 'appareil-essai-proprio' } })).body;
      assert.equal(pro.ok, true, String(pro.message)); assert.deepEqual((pro.personne as { groups: string[] }).groups, ['admin']);
    });

    await t.test('SSO du poste : une appli se connecte, une seconde échange le jeton sans mot de passe ; révocation', async () => {
      const c = fauxCoffre();
      const venus = new OdinSSO({ adresse: v.url, appli: 'venus', appareil: { nom: 'PC du salon', plateforme: 'linux' }, utilisateur: 'moussa-os', coffre: c });
      const r = await venus.connecter({ identifiant: 'moussa', motdepasse: MDP_MOUSSA }); assert.equal(r.ok, true, r.message); assert.equal(r.poste, true);
      assert.match(c.m.get(`Odin SSO ${v.url}`) ?? '', /^odp1\.[a-f0-9]{10}\.[A-Za-z0-9_-]{43}$/, 'jeton du poste rangé dans le coffre, sous « Odin SSO <adresse> »');
      assert.match(c.m.get('Odin SSO appareil') ?? '', /^[A-Za-z0-9_-]{8,64}$/);
      const pegase = new OdinSSO({ adresse: v.url, appli: 'pegase', appareil: { nom: 'PC du salon', plateforme: 'linux' }, utilisateur: 'moussa-os', coffre: c });
      const o = await pegase.ouvrir(); assert.equal(o.ok, true, o.message); assert.equal(o.par, 'poste'); assert.equal(o.personne.preferred_username, 'moussa');
      assert.equal((await pegase.infos()).appli, 'pegase');
      // Autre utilisateur du système, même appareil : refusé.
      const intrus = new OdinSSO({ adresse: v.url, appli: 'pegase', appareil: { nom: 'PC du salon' }, utilisateur: 'quelqu-un-d-autre', coffre: { ...c, effacer: async () => undefined } });
      assert.equal((await intrus.ouvrir()).code, 'jeton_poste_invalide');
      // Sans droit : le message d'Odin, tel quel.
      const c2 = fauxCoffre(), zp = new OdinSSO({ adresse: v.url, appli: 'pegase', appareil: { nom: 'Tablette' }, utilisateur: 'zaina-os', coffre: c2 });
      assert.equal((await zp.connecter({ identifiant: 'zaina', motdepasse: MDP_ZAINA })).ok, true);
      const zv = new OdinSSO({ adresse: v.url, appli: 'venus', appareil: { nom: 'Tablette' }, utilisateur: 'zaina-os', coffre: c2 });
      const refus = await zv.ouvrir(); assert.equal(refus.ok, false); assert.equal(refus.code, 'refuse'); assert.equal(refus.message, 'Tu n\'as pas accès à Vénus. Demande à Awa de t\'ajouter au groupe famille.');
      assert.ok(c2.m.get(`Odin SSO ${v.url}`), 'un refus ne vide pas le coffre (les autres applis restent connectées)');
      // Persona montre le poste et les applis connectées.
      const vue = await va.module('var')!.view(va.ctx('var'), new URLSearchParams()), tab = vue.sections.find((x) => x.title === 'Appareils connectés') as { rows: Array<{ cells: string[] }> };
      assert.ok(tab.rows.some((x) => x.cells[1] === 'poste (SSO)' && /moussa-os/.test(x.cells[2]))); assert.ok(tab.rows.some((x) => x.cells[1] === 'Pégase' && x.cells[3] === 'poste'));
      // Se déconnecter d'Odin sur le poste : tout est coupé, le coffre est vidé.
      await pegase.deconnecter();
      assert.equal(c.m.has(`Odin SSO ${v.url}`), false);
      assert.equal((await venus.infos()).code, 'jeton_invalide', 'la session de Vénus (liée au poste) est coupée aussi');
      assert.equal((await venus.renouveler()).ok, false);
      assert.equal((await pegase.ouvrir()).code, 'pas_de_session');
    });

    await t.test('renouvellement : rotation, lié à l\'appareil, ancien jeton toléré 60 s (même couple), d\'un autre appareil = session coupée', async () => {
      const sso = new OdinSSO({ adresse: v.url, appli: 'pegase', appareil: { id: 'appareil-essai-rotation', nom: 'Portable' }, coffre: fauxCoffre() });
      assert.equal((await sso.connecter({ identifiant: 'moussa', motdepasse: MDP_MOUSSA, poste: false })).ok, true);
      const vieux = sso.etat.refresh; assert.equal((await sso.renouveler()).ok, true); assert.notEqual(sso.etat.refresh, vieux);
      const jeton = (rt: string, appareil: string) => fetch(`${v.url}/sso/jeton`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: 'pegase', appareil }) });
      const autre = await jeton(sso.etat.refresh, 'un-autre-appareil-x');
      assert.equal(autre.status, 400); assert.match((await autre.json() as Record<string, string>).message, /autre appareil/);
      // Réponse perdue : le même appareil représente l'ancien jeton dans les 60 s → le MÊME couple (pas une seconde branche).
      const rejoue = await jeton(vieux, 'appareil-essai-rotation'); assert.equal(rejoue.status, 200);
      const rj = await rejoue.json() as Record<string, string | number>;
      assert.equal(rj.refresh_token, sso.etat.refresh, 'même jeton de renouvellement'); assert.equal(rj.access_token, sso.etat.access, 'même jeton d\'accès');
      assert.ok(Number(rj.expires_in) <= 900 && Number(rj.expires_in) > 840, 'durée restante du même jeton');
      // Le même ancien jeton présenté par un autre appareil : vol probable → session coupée et alerte.
      const vol = await jeton(vieux, 'un-autre-appareil-x'); assert.equal(vol.status, 400); assert.match((await vol.json() as Record<string, string>).message, /déjà servi/);
      assert.equal((await sso.renouveler()).ok, false, 'la session entière est coupée');
      assert.ok(va.alerts({ limit: 50 }).some((a) => /coupée/.test(a.title)));
    });

    await t.test('sauvegarde envoyée puis restaurée octet par octet, chiffrée sur le disque', async () => {
      const sso = new OdinSSO({ adresse: v.url, appli: 'venus', appareil: { id: 'appareil-essai-sauvegarde', nom: 'Serveur Vénus' }, coffre: fauxCoffre() });
      assert.equal((await sso.connecter({ identifiant: 'moussa', motdepasse: MDP_MOUSSA, poste: false })).ok, true);
      const marque = 'BASE-DE-VENUS-EN-CLAIR-', base = Buffer.concat([Buffer.from(marque.repeat(2000)), randomBytes(300_000)]);
      const r = await sso.sauvegarder(base, { raison: 'nouvel utilisateur', nom: 'venus-base.tar.gz' });
      assert.equal(r.ok, true, r.message); assert.equal(r.inchange, false); assert.equal(r.version.taille, base.length); assert.equal(r.version.raison, 'nouvel utilisateur');
      assert.equal((await sso.sauvegarder(base, { raison: 'vérification' })).inchange, true, 'même empreinte : rien de rangé');
      const e = await sso.empreinteOdin(); assert.equal(e.empreinte, createHash('sha256').update(base).digest('hex')); assert.equal(e.restaurer, null);
      const l = await sso.versions(); assert.equal(l.versions.length, 1); assert.equal(l.taille_max, 500 * 1048576);
      const dir = join(v.o.paths.home, 'valhalla', 'freyja', 'sauvegardes', 'moussa');
      assert.equal(partout(dir, marque).length, 0, 'rien en clair sur le disque');
      const back = await sso.telecharger(r.version.id); assert.ok(back.equals(base), 'restaurée octet par octet');
      // « Restaurer » depuis la page Vénus d'Odin : l'appli le voit à sa vérification, puis le confirme.
      const vue = await va.module('freyja')!.view(va.ctx('freyja'), new URLSearchParams()), carte = vue.sections.find((x) => x.title === 'Sauvegarde sur Odin') as { kind: string; items: Array<{ title: string; sub: string; actions: Array<{ action: string; input: Record<string, unknown> }> }> };
      assert.equal(carte.kind, 'cards'); assert.match(carte.items[0].sub, /1 version\(s\) · compte moussa · nouvel utilisateur/);
      const a = carte.items[0].actions[0]; assert.equal(a.action, 'restaurer_sauvegarde');
      assert.equal((await va.act('freyja', 'restaurer_sauvegarde', a.input)).ok, true);
      assert.equal((await sso.empreinteOdin()).restaurer, r.version.id);
      assert.equal(await sso.restauree(r.version.id), true); assert.equal((await sso.empreinteOdin()).restaurer, null);
      // Erreurs : empreinte fausse, jeton d'une autre appli, appli inconnue.
      const tok = await sso.jeton();
      let x = await fetch(`${v.url}/api/sauvegardes/venus`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'x-odin-empreinte': 'a'.repeat(64), 'content-type': 'application/octet-stream' }, body: new Uint8Array(base.subarray(0, 100)) });
      assert.equal(x.status, 400); assert.equal((await x.json() as Record<string, string>).code, 'empreinte_fausse');
      x = await fetch(`${v.url}/api/sauvegardes/pegase`, { headers: { authorization: `Bearer ${tok}` } }); assert.equal(x.status, 403); assert.equal((await x.json() as Record<string, string>).code, 'mauvaise_appli');
      x = await fetch(`${v.url}/api/sauvegardes/venus`); assert.equal(x.status, 401);
      // Taille max réglable.
      assert.equal((await va.act('var', 'taille_sauvegardes', { appli: 'venus', mo: 1 })).ok, true);
      const gros = randomBytes(1_200_000), g = await sso.sauvegarder(gros); assert.equal(g.ok, false); assert.equal(g.code, 'trop_gros');
      assert.equal((await sso.versions()).versions.length, 1);
    });

    await t.test('interface d\'Odin par Persona : une personne de la famille voit Vénus mais pas Cerbère ni Hermès', async () => {
      const entrer = async (ident: string, mdp: string) => {
        let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
        r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
        r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
        r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
        return cookieDe(r, 'odin_session');
      };
      const m = await entrer('moussa', MDP_MOUSSA); assert.match(m, /^odin_session=[A-Za-z0-9_-]{43}$/);
      const g = (p: string) => v.json(p, undefined, { cookie: m }), post = (p: string, b: unknown) => v.json(p, b, { cookie: m });
      const page = await (await fetch(`${v.url}/`, { headers: { cookie: m } })).text(); assert.match(page, /const AUTHED = true;/);
      const cat = (await g('/api/valhalla/catalog')).body as { modules: Array<{ id: string }> }, ids = cat.modules.map((x) => x.id);
      assert.ok(ids.includes('freyja'), 'Vénus visible'); assert.ok(!ids.includes('garmr'), 'Cerbère caché'); assert.ok(!ids.includes('fjalar'), 'Hermès caché'); assert.ok(!ids.includes('var'), 'Persona caché');
      const vue = await g('/api/valhalla/view?id=garmr'); assert.equal(vue.status, 403); assert.equal(vue.body.error, 'Tu n\'as pas accès à Cerbère. Demande à Awa de te donner l\'accès.');
      const act = await post('/api/valhalla/act', { module: 'garmr', action: 'bannir', input: { ip: '203.0.113.9', minutes: 5 }, confirm: true }); assert.equal(act.status, 403);
      const phrase = await post('/api/valhalla/order', { text: 'bannis 203.0.113.9', confirm: true }); assert.equal(phrase.body.ok, false, String(phrase.body.text)); assert.match(String(phrase.body.text), /Tu n'as pas accès à Cerbère/);
      assert.equal((await post('/api/message', { text: 'bannis 203.0.113.9' })).status, 403, 'pas de conversation avec l\'IA pour un membre');
      assert.deepEqual((await g('/api/history')).body.messages, [], 'les conversations du propriétaire restent cachées'); assert.equal((await post('/api/backup', { password: 'x' })).status, 403);
      const st = (await g('/api/state')).body as { membre: { login: string }; devices: unknown[] }; assert.equal(st.membre.login, 'moussa'); assert.deepEqual(st.devices, []);
      assert.equal(((await g('/api/account/me')).body as { profile: { prenom: string } }).profile.prenom, 'Moussa');
      // Le propriétaire voit tout.
      const tout = ((await v.json('/api/valhalla/catalog')).body as { modules: Array<{ id: string }> }).modules.map((x) => x.id); assert.ok(tout.includes('garmr') && tout.includes('fjalar'));
      // Port direct de Cerbère : refusé à Moussa, ouvert au propriétaire.
      const p = await freePort(), rp = (await v.json('/api/ports', { appli: 'garmr', faire: 'regler', port: p })).body as { ok: boolean; text?: string; confirm?: string }; assert.equal(rp.ok, true, JSON.stringify(rp));
      const dm = await fetch(`http://127.0.0.1:${p}/api/valhalla/view?id=garmr`, { headers: { cookie: m } }); assert.equal(dm.status, 403); assert.match((await dm.json() as Record<string, string>).message, /pas accès à Cerbère/);
      assert.equal((await fetch(`http://127.0.0.1:${p}/api/valhalla/view?id=garmr`, { headers: { cookie: v.session } })).status, 200);
      // Les cases de Persona (onglet Accès) : la famille reçoit Cerbère, puis le perd.
      assert.equal((await va.act('var', 'acces_cases', { qui: 'famille', garmr: true })).ok, true);
      assert.ok(((await g('/api/valhalla/catalog')).body as { modules: Array<{ id: string }> }).modules.some((x) => x.id === 'garmr'));
      assert.equal((await va.act('var', 'retirer_acces', { appli: 'Cerbère', qui: 'famille' })).ok, true);
      assert.ok(!((await g('/api/valhalla/catalog')).body as { modules: Array<{ id: string }> }).modules.some((x) => x.id === 'garmr'));
      // Déconnexion du membre.
      assert.equal((await post('/api/account/logout', {})).status, 200); assert.equal((await g('/api/valhalla/catalog')).status, 401);
      // Le propriétaire peut aussi entrer par Persona : il retrouve sa session habituelle.
      const pr = await entrer(COMPTE.email, COMPTE.password); assert.match(pr, /^odin_session=/);
      assert.equal(((await v.json('/api/account/me', undefined, { cookie: pr })).body as { profile: { email: string } }).profile.email, COMPTE.email);
    });

    await t.test('le compte du propriétaire devient la personne admin de Persona, sans perte et réversible', async () => {
      const ctx = va.ctx('var'), pro = () => (ctx.settings.people as Array<{ login: string; groups: string[]; proprio?: boolean; email?: string; hash: string }>).find((x) => x.proprio);
      assert.deepEqual([pro()?.login, pro()?.groups, pro()?.email, pro()?.hash], ['proprietaire', ['admin'], COMPTE.email, ''], 'aucune copie du mot de passe');
      assert.equal((await va.act('var', 'delier_proprietaire', {})).ok, true); assert.equal(pro(), undefined);
      const login = await v.json('/api/account/login', { email: COMPTE.email, password: COMPTE.password }, { cookie: '' }); assert.equal(login.status, 200, 'le compte d\'Odin marche toujours');
      assert.equal((await va.act('var', 'relier_proprietaire', {})).ok, true); assert.equal(pro()?.login, 'proprietaire');
      assert.equal(readFileSync(join(v.o.paths.home, 'compte.json'), 'utf8'), compteAvant, 'compte.json jamais touché');
    });

    await t.test('mot de passe jamais dans un fichier ni dans un journal', () => {
      for (const mdp of [MDP_MOUSSA, MDP_ZAINA, COMPTE.password]) {
        assert.deepEqual(partout(v.o.paths.home, mdp), [], 'dans aucun fichier d\'Odin');
        assert.ok(!logs.some((l) => l.includes(mdp)), 'dans aucun journal');
      }
    });
  } finally { Object.assign(console, orig); await tt.end(); }
});

test('coffre du système sur Linux : secret-tool', { timeout: 60_000 }, async (t) => {
  const tt = new T();
  try {
    const vrai = await coffreSysteme.disponible();
    t.diagnostic(`secret-tool réel : ${vrai ? 'présent' : 'absent ou sans Secret Service (pas de SSO du poste sur cette machine)'}`);
    // Le dialogue avec secret-tool, par un faux secret-tool qui garde ses secrets dans un dossier (protocole de la commande).
    const dir = tt.tmp('faux-secret-tool-'), store = join(dir, 'store');
    writeFileSync(join(dir, 'secret-tool'), `#!/bin/sh\nmkdir -p "${store}"\ncmd="$1"; shift\ncase "$cmd" in\n store) shift; k=$(echo "$*" | md5sum | cut -c1-16); cat > "${store}/$k"; echo "$*" >> "${store}/args" ;;\n lookup) k=$(echo "$*" | md5sum | cut -c1-16); [ -f "${store}/$k" ] && cat "${store}/$k" || exit 1 ;;\n clear) k=$(echo "$*" | md5sum | cut -c1-16); rm -f "${store}/$k" ;;\nesac\n`, { mode: 0o755 });
    const avant = process.env.PATH; process.env.PATH = `${dir}:${avant}`; tt.onEnd(() => { process.env.PATH = avant; });
    if (coffreSysteme.systeme !== 'linux') return;
    assert.equal(await coffreSysteme.disponible(), true);
    await coffreSysteme.ranger('Odin SSO https://192.168.1.10:7777', 'odp1.abcdef0123.secret-de-l-essai');
    assert.equal(await coffreSysteme.lire('Odin SSO https://192.168.1.10:7777'), 'odp1.abcdef0123.secret-de-l-essai');
    assert.doesNotMatch(readFileSync(join(store, 'args'), 'utf8'), /secret-de-l-essai/, 'le secret passe par l\'entrée standard, jamais par la ligne de commande');
    await coffreSysteme.effacer('Odin SSO https://192.168.1.10:7777');
    assert.equal(await coffreSysteme.lire('Odin SSO https://192.168.1.10:7777'), undefined);
    rmSync(store, { recursive: true, force: true });
  } finally { await tt.end(); }
});

test('certificat épinglé : le corps ne part pas vers un autre certificat', { timeout: 60_000 }, async (t) => {
  const tt = new T();
  try {
    const { execFileSync } = await import('node:child_process'); const dir = tt.tmp('tls-');
    try { execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=odin'], { stdio: 'ignore' }); } catch { t.skip('openssl absent'); return; }
    const { createServer } = await import('node:https'); let recu = 0;
    const srv = createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (q, s) => { q.on('data', (c: Buffer) => { recu += c.length; }); q.on('end', () => { s.end('{"ok":true}'); }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r())); tt.onEnd(() => srv.close());
    const adr = `https://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const premier = await requete(adr, '/x', { premierContact: true }); assert.match(premier.empreinte, /^[a-f0-9]{64}$/);
    assert.equal((await requete(adr, '/x', { empreinte: premier.empreinte, corps: { motdepasse: 'secret' } })).status, 200); assert.ok(recu > 0);
    recu = 0;
    await assert.rejects(requete(adr, '/x', { empreinte: 'b'.repeat(64), corps: { motdepasse: 'secret' } }), /certificat d'Odin a changé/);
    assert.equal(recu, 0, 'rien envoyé au mauvais certificat');
    await assert.rejects(requete(adr, '/x', {}), /self[- ]signed|certificate/i, 'sans épingle : vérification normale');
  } finally { await tt.end(); }
});
