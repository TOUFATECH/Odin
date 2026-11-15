// Export vers Google Docs : connexion par code (OAuth 2.0 pour appareils à saisie limitée), rafraîchissement,
// révocation, et création du document par téléversement multipart de Drive (conversion HTML → Docs).
// Tout est essayé contre un FAUX serveur Google écrit d'après la documentation officielle :
//   - developers.google.com/identity/protocols/oauth2/limited-input-device (device/code, token, erreurs, revoke) ;
//   - developers.google.com/workspace/drive/api/guides/manage-uploads (uploadType=multipart, multipart/related).
// Aucune vraie connexion à Google n'est faite ici.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { ConnexionGoogle, corpsMultipart, nettoyer, reglerGoogle, titreDocument } from '../src/valhalla/export/google.ts';
import type { PageExport } from '../src/valhalla/export/page.ts';
import { vaultEnable, vaultLock } from '../src/vault.ts';
import { exportApi } from '../src/web/export-api.ts';

const CLIENT_ID = '123456789-abcdefgh.apps.googleusercontent.com', CLIENT_SECRET = 'GOCSPX-secretDuClient42', DEVICE = 'AH-1Ng-code-appareil-secret';
const REFRESH = '1//0gRafraichirTresSecret-abc', ACCES1 = 'ya29.premierAcces-xyz', ACCES2 = 'ya29.secondAcces-uvw';
const SECRETS = [CLIENT_SECRET, DEVICE, REFRESH, ACCES1, ACCES2];

// ------------------------------------------------------------------ Le faux Google
interface Faux { url: string; appels: Array<{ chemin: string; champs: Record<string, string>; auth?: string; type?: string; corps: Buffer }>; mode: Record<string, string>; jetonsTour: number; uploads401: number }
const faux: Faux = { url: '', appels: [], mode: {}, jetonsTour: 0, uploads401: 0 };
let serveur: Server;
const lire = async (req: IncomingMessage) => { const p: Buffer[] = []; for await (const c of req) p.push(c as Buffer); return Buffer.concat(p); };
const repondre = (res: import('node:http').ServerResponse, code: number, corps: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(corps)); };

before(async () => {
  serveur = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x'), corps = await lire(req);
    const formulaire = String(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded');
    const champs = formulaire ? Object.fromEntries(new URLSearchParams(corps.toString('utf8'))) : {};
    faux.appels.push({ chemin: `${u.pathname}${u.search}`, champs, auth: req.headers.authorization, type: String(req.headers['content-type'] ?? ''), corps });
    if (req.method !== 'POST') return repondre(res, 405, { error: 'method' });
    if (u.pathname === '/oauth/device/code') {
      if (champs.client_id !== CLIENT_ID) return repondre(res, 401, { error: 'invalid_client' });
      return repondre(res, 200, { device_code: DEVICE, user_code: 'GQVQ-JKEC', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 1 });
    }
    if (u.pathname === '/oauth/token') {
      if (champs.client_id !== CLIENT_ID || champs.client_secret !== CLIENT_SECRET) return repondre(res, 401, { error: 'invalid_client', error_description: `client ${CLIENT_SECRET} inconnu` });
      if (champs.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
        if (champs.device_code !== DEVICE) return repondre(res, 400, { error: 'invalid_grant' });
        if (faux.mode.appareil === 'refus') return repondre(res, 403, { error: 'access_denied', error_description: 'Forbidden' });
        faux.jetonsTour++;
        if (faux.jetonsTour === 1) return repondre(res, 428, { error: 'authorization_pending', error_description: 'Precondition Required' });
        if (faux.jetonsTour === 2) return repondre(res, 403, { error: 'slow_down', error_description: 'Forbidden' });
        return repondre(res, 200, { access_token: ACCES1, expires_in: 3599, refresh_token: REFRESH, scope: 'https://www.googleapis.com/auth/drive.file', token_type: 'Bearer' });
      }
      if (champs.grant_type === 'refresh_token') {
        if (faux.mode.rafraichir === 'retire' || champs.refresh_token !== REFRESH) return repondre(res, 400, { error: 'invalid_grant', error_description: `Token has been expired or revoked: ${REFRESH}` });
        return repondre(res, 200, { access_token: ACCES2, expires_in: 3599, scope: 'https://www.googleapis.com/auth/drive.file', token_type: 'Bearer' });
      }
      return repondre(res, 400, { error: 'unsupported_grant_type' });
    }
    if (u.pathname === '/oauth/revoke') return champs.token === REFRESH ? repondre(res, 200, {}) : repondre(res, 400, { error: 'invalid_token' });
    if (u.pathname === '/upload/drive/v3/files') {
      if (u.searchParams.get('uploadType') !== 'multipart') return repondre(res, 400, { error: { code: 400, message: 'uploadType' } });
      if (faux.uploads401 > 0) { faux.uploads401--; return repondre(res, 401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }); }
      if (req.headers.authorization !== `Bearer ${ACCES1}` && req.headers.authorization !== `Bearer ${ACCES2}`) return repondre(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
      if (faux.mode.upload === 'plein') return repondre(res, 403, { error: { code: 403, message: `quota ${ACCES1}`, errors: [{ reason: 'storageQuotaExceeded' }] } });
      if (faux.mode.upload === 'panne') return repondre(res, 503, { error: { code: 503, message: 'Backend Error' } });
      // Vérifie le corps multipart/related comme Drive : frontière, deux parties, métadonnées JSON puis le contenu.
      const m = /^multipart\/related; boundary=([A-Za-z0-9_'()+,./:=?-]{1,70})$/.exec(String(req.headers['content-type'] ?? ''));
      if (!m) return repondre(res, 400, { error: { code: 400, message: 'Content-Type' } });
      if (Number(req.headers['content-length']) !== corps.length) return repondre(res, 400, { error: { code: 400, message: 'Content-Length' } });
      const t = corps.toString('utf8'), b = m[1];
      if (!t.startsWith(`--${b}\r\n`) || !t.endsWith(`\r\n--${b}--\r\n`)) return repondre(res, 400, { error: { code: 400, message: 'frontière' } });
      const parts = t.slice(0, -(`--${b}--\r\n`.length)).split(`--${b}\r\n`).slice(1).map((p) => { const i = p.indexOf('\r\n\r\n'); return { tetes: p.slice(0, i), contenu: p.slice(i + 4).replace(/\r\n$/, '') }; });
      if (parts.length !== 2 || !/^Content-Type: application\/json; charset=UTF-8$/i.test(parts[0].tetes) || !/^Content-Type: text\/html/i.test(parts[1].tetes)) return repondre(res, 400, { error: { code: 400, message: 'parties' } });
      const meta = JSON.parse(parts[0].contenu) as { name: string; mimeType: string };
      if (meta.mimeType !== 'application/vnd.google-apps.document') return repondre(res, 400, { error: { code: 400, message: 'mimeType' } });
      faux.mode.dernierHtml = parts[1].contenu; faux.mode.dernierNom = meta.name;
      return repondre(res, 200, { kind: 'drive#file', id: '1AbCdEfGhIjKlMnOpQrStUv', name: meta.name, mimeType: meta.mimeType });
    }
    repondre(res, 404, { error: 'introuvable' });
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  faux.url = `http://127.0.0.1:${(serveur.address() as { port: number }).port}`;
});
after(() => serveur.close());

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const nouveau = () => { const d = mkdtempSync(join(tmpdir(), 'odin-google-')); dossiers.push(d); return d; };
const reglages = (env: NodeJS.ProcessEnv) => ({ oauth: `${faux.url}/oauth`, upload: `${faux.url}/upload/drive/v3`, env, pasMs: 5 });
const remettre = () => { faux.appels = []; faux.mode = {}; faux.jetonsTour = 0; faux.uploads401 = 0; };
const sansSecret = (t: string, quoi: string) => { for (const s of SECRETS) assert.ok(!t.includes(s), `${quoi} contient un secret`); };
const attendre = async (ok: () => boolean, ms = 3000) => { const fin = Date.now() + ms; while (!ok()) { if (Date.now() > fin) throw new Error('trop long'); await new Promise((r) => setTimeout(r, 5)); } };

const PAGE: PageExport = { odin: 1, at: '2026-11-15T10:00:00.000Z', app: { id: 'eir', name: 'Hygie', family: 'Machines', what: 'La santé de la machine' }, subtitle: 'tout va bien', kpis: [{ label: 'Processeur', value: '12 %' }], sections: [{ kind: 'text', title: 'Note', text: '<script>alert(1)</script> à vérifier' }, { kind: 'table', title: 'Disques', columns: ['Disque', 'Libre'], rows: [{ cells: ['/', '40 Go'] }] }], retire: [], masques: 0 };

async function relier(home: string, env: NodeJS.ProcessEnv): Promise<ConnexionGoogle> {
  const g = new ConnexionGoogle(home, reglages(env));
  g.enregistrerClient(CLIENT_ID, CLIENT_SECRET);
  const c = await g.demarrer();
  assert.deepEqual([c.code, c.adresse], ['GQVQ-JKEC', 'https://www.google.com/device']);
  await attendre(() => g.connecte());
  return g;
}

// ------------------------------------------------------------------ Pièces pures
test('corps multipart/related : métadonnées JSON puis le HTML, frontières selon la documentation de Drive', () => {
  const b = corpsMultipart('frontiere_x', { name: 'Hygie', mimeType: 'application/vnd.google-apps.document' }, 'text/html; charset=UTF-8', Buffer.from('<p>é</p>'));
  assert.equal(b.toString('utf8'), '--frontiere_x\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"Hygie","mimeType":"application/vnd.google-apps.document"}\r\n--frontiere_x\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>é</p>\r\n--frontiere_x--\r\n');
  assert.throws(() => corpsMultipart('x', {}, 'text/html', Buffer.from('a --x b')), /frontière/);
  assert.equal(titreDocument({ ...PAGE, onglet: 'Disques' }), 'Hygie - Disques - 2026-11-15');
  assert.equal(nettoyer(`a ${REFRESH} b ya29.autre c GOCSPX-zz`, REFRESH), 'a [masqué] b [masqué] c [masqué]');
});

// ------------------------------------------------------------------ Connexion par code
test('connexion par code : attente, « ralentis », puis jeton durable rangé dans le fichier env (jamais montré)', async () => {
  remettre(); const home = nouveau(), env: NodeJS.ProcessEnv = {};
  assert.throws(() => new ConnexionGoogle(home, reglages(env)).enregistrerClient('pas-un-client', CLIENT_SECRET), /identifiant de client invalide/);
  await assert.rejects(new ConnexionGoogle(home, reglages(env)).demarrer(), /enregistre d'abord/);
  const g = await relier(home, env);
  const jetons = faux.appels.filter((a) => a.chemin === '/oauth/token');
  assert.equal(jetons.length, 3, 'en attente, ralentis, puis réussi');
  assert.equal(jetons[0].champs.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(jetons[0].champs.device_code, DEVICE);
  const code = faux.appels.find((a) => a.chemin === '/oauth/device/code')!;
  assert.deepEqual(code.champs, { client_id: CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.file' });
  // Les secrets sont dans le fichier env d'Odin (le coffre le chiffre quand il est activé), pas ailleurs.
  const fichier = readFileSync(join(home, 'env'), 'utf8');
  assert.match(fichier, new RegExp(`GOOGLE_OAUTH_REFRESH_TOKEN=${REFRESH.replace(/[/.]/g, '\\$&')}`));
  assert.match(fichier, /GOOGLE_OAUTH_CLIENT_SECRET=/);
  const e = g.etat(); assert.equal(e.connecte, true); assert.equal(e.client, true); sansSecret(JSON.stringify(e), 'l\'état');
});

test('connexion refusée par le propriétaire : rien n\'est rangé, la raison est dite', async () => {
  remettre(); faux.mode.appareil = 'refus'; const home = nouveau(), env: NodeJS.ProcessEnv = {};
  const g = new ConnexionGoogle(home, reglages(env)); g.enregistrerClient(CLIENT_ID, CLIENT_SECRET);
  await g.demarrer();
  await attendre(() => Boolean(g.etat().erreur));
  assert.match(g.etat().erreur!, /refusé l'accès/); assert.equal(g.connecte(), false); assert.equal(env.GOOGLE_OAUTH_REFRESH_TOKEN, undefined);
});

// ------------------------------------------------------------------ Document
test('export : document créé par Drive (multipart, jeton d\'accès dans l\'en-tête), HTML échappé, lien Docs', async () => {
  remettre(); const g = await relier(nouveau(), {});
  const d = await g.creerDocument(PAGE);
  assert.deepEqual(d, { id: '1AbCdEfGhIjKlMnOpQrStUv', lien: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit', nom: 'Hygie - 2026-11-15' });
  const up = faux.appels.find((a) => a.chemin.startsWith('/upload/'))!;
  assert.equal(up.auth, `Bearer ${ACCES1}`);
  assert.match(up.chemin, /uploadType=multipart/);
  assert.match(faux.mode.dernierHtml, /Hygie/); assert.match(faux.mode.dernierHtml, /40 Go/);
  assert.ok(!faux.mode.dernierHtml.includes('<script>'), 'le texte des données est échappé');
});

test('jeton d\'accès périmé (401) : un rafraîchissement, une seule nouvelle tentative', async () => {
  remettre(); const g = await relier(nouveau(), {});
  faux.uploads401 = 1;
  const d = await g.creerDocument(PAGE); assert.equal(d.id, '1AbCdEfGhIjKlMnOpQrStUv');
  const rafr = faux.appels.filter((a) => a.champs.grant_type === 'refresh_token');
  assert.equal(rafr.length, 1); assert.equal(rafr[0].champs.refresh_token, REFRESH);
  assert.equal(faux.appels.filter((a) => a.chemin.startsWith('/upload/')).at(-1)!.auth, `Bearer ${ACCES2}`);
  // Deux 401 de suite : on s'arrête (pas de boucle).
  faux.uploads401 = 5; await assert.rejects(g.creerDocument(PAGE), (e: Error) => { sansSecret(e.message, 'l\'erreur'); return /relie à nouveau/.test(e.message); });
  assert.ok(faux.uploads401 >= 3, 'deux essais au plus');
});

test('refus de Google en phrases claires, sans secret (Drive plein, panne, connexion retirée)', async () => {
  remettre(); const env: NodeJS.ProcessEnv = {}; const g = await relier(nouveau(), env);
  faux.mode.upload = 'plein'; await assert.rejects(g.creerDocument(PAGE), (e: Error) => { sansSecret(e.message, 'l\'erreur'); return /Drive est plein/.test(e.message); });
  faux.mode.upload = 'panne'; await assert.rejects(g.creerDocument(PAGE), /en panne/);
  // Connexion retirée chez Google : le jeton durable est oublié, on le dit.
  faux.mode.upload = ''; faux.mode.rafraichir = 'retire'; faux.uploads401 = 1;
  await assert.rejects(g.creerDocument(PAGE), (e: Error) => { sansSecret(e.message, 'l\'erreur'); return /relie à nouveau ton compte/.test(e.message); });
  assert.equal(g.connecte(), false); assert.equal(env.GOOGLE_OAUTH_REFRESH_TOKEN, undefined);
});

test('déconnexion : jeton révoqué chez Google puis oublié', async () => {
  remettre(); const home = nouveau(), env: NodeJS.ProcessEnv = {}; const g = await relier(home, env);
  assert.deepEqual(await g.deconnecter(), { revoque: true });
  assert.equal(faux.appels.find((a) => a.chemin === '/oauth/revoke')!.champs.token, REFRESH);
  assert.equal(g.connecte(), false); assert.ok(!readFileSync(join(home, 'env'), 'utf8').includes(REFRESH));
});

test('coffre verrouillé : la connexion n\'est pas lisible et on le dit', () => {
  const home = nouveau(); vaultEnable(home, 'mot-de-passe-du-coffre'); vaultLock(home);
  const g = new ConnexionGoogle(home, reglages({}));
  assert.match(g.etat().coffre ?? '', /coffre est verrouillé/);
  assert.throws(() => g.enregistrerClient(CLIENT_ID, CLIENT_SECRET), /verrouillé/);
});

// ------------------------------------------------------------------ Adresses de l'API (sans démarrer les applis)
test('routes de la connexion Google : en-tête x-odin exigé, aucun secret dans les réponses', async () => {
  remettre(); const home = nouveau(), avant = process.env.ODIN_HOME; process.env.ODIN_HOME = home;
  const env: NodeJS.ProcessEnv = {}; reglerGoogle(resolve(home), reglages(env));
  const api = createServer((req, res) => { void exportApi(req, res, new URL(req.url ?? '/', 'http://x'), {}).then((pris) => { if (!pris) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(api.address() as { port: number }).port}/api/valhalla/export/google`;
  const post = (q: string, corps: unknown, odin = true) => fetch(`${base}/${q}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(odin ? { 'x-odin': '1' } : {}) }, body: JSON.stringify(corps) });
  try {
    let r = await post('client', { id: CLIENT_ID, secret: CLIENT_SECRET }, false); assert.equal(r.status, 403); await r.text();
    r = await fetch(`${base}/etat`, { method: 'POST' }); assert.equal(r.status, 405); await r.text();
    r = await fetch(`${base}/autre`); assert.equal(r.status, 404); await r.text();
    let j = await (await post('client', { id: 'faux', secret: CLIENT_SECRET })).json() as { ok: boolean; error: string }; assert.equal(j.ok, false); assert.match(j.error, /identifiant/);
    let t = await (await post('client', { id: CLIENT_ID, secret: CLIENT_SECRET })).text(); sansSecret(t, 'la réponse'); assert.match(t, /"ok":true/);
    t = await (await post('connexion', {})).text(); sansSecret(t, 'la réponse'); assert.match(t, /GQVQ-JKEC/);
    await attendre(() => Boolean(env.GOOGLE_OAUTH_REFRESH_TOKEN));
    t = await (await fetch(`${base}/etat`)).text(); sansSecret(t, 'l\'état'); assert.match(t, /"connecte":true/);
    t = await (await post('deconnexion', {})).text(); sansSecret(t, 'la réponse'); assert.match(t, /révoqué/); assert.match(t, /"connecte":false/);
  } finally { api.close(); if (avant === undefined) delete process.env.ODIN_HOME; else process.env.ODIN_HOME = avant; }
});
