// Le double facteur du compte du propriétaire d'Odin : activation (QR code, premier code), code à chaque connexion,
// fenêtre de ±30 s, code rejoué refusé, attente comptée par adresse, secours par un lien envoyé à l'adresse e-mail
// du compte + le mot de passe, retrait connecté (mot de passe ET code), commande de dernier recours, secret jamais
// en clair sur le disque. Aucun vrai envoi d'e-mail : un faux transport garde le message.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Accounts } from '../src/web/account.ts';
import { DoubleFacteur, retirerSurLaMachine } from '../src/web/double-facteur.ts';
import { totp } from '../src/valhalla/modules/brisingamen.ts';

const home = () => mkdtempSync(join(tmpdir(), 'odin-2fa-'));
const OK = { prenom: 'Sami', nom: 'Test', email: 'sami@example.org', password: 'une-tortue-lente-traverse-le-lagon' };
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % 30_000) + 5_000; // 5 s après le début d'un pas de 30 s
const code = (secret: string, at: number) => totp(secret, at).code;
const faux = (secret: string, at: number) => { const c = code(secret, at); return c === '000000' ? '111111' : '000000'; };

/** Tous les fichiers d'un dossier, lus en texte (pour vérifier qu'un secret n'y est jamais en clair). */
function toutLeDisque(dir: string): string {
  let t = '';
  for (const n of readdirSync(dir)) { const p = join(dir, n); t += statSync(p).isDirectory() ? toutLeDisque(p) : readFileSync(p).toString('latin1'); }
  return t;
}

async function monter(o: { envoi?: boolean } = {}) {
  let now = T0;
  const h = home(), acc = new Accounts(h, { scryptN: 1024, now: () => now });
  await acc.create(OK);
  const mails: Array<{ a: string; sujet: string; texte: string }> = [];
  const df = new DoubleFacteur(h, acc, { now: () => now, ...(o.envoi === false ? {} : { envoi: async (a: string, sujet: string, texte: string) => { mails.push({ a, sujet, texte }); } }) });
  return { h, acc, df, mails, avance: (ms: number) => { now += ms; }, at: () => now };
}
/** Active le double facteur (mot de passe + premier code) et rend le secret. */
async function activer(x: Awaited<ReturnType<typeof monter>>): Promise<string> {
  const q = await x.df.commencer('session-a', { password: OK.password }, '192.0.2.10');
  x.df.confirmer('session-a', code(q.secret, x.at()), '192.0.2.10');
  return q.secret;
}

test('activation : le QR code, puis seulement après un premier code juste ; le mot de passe est exigé', async () => {
  const x = await monter();
  assert.equal(x.df.actif(), false);
  await assert.rejects(x.df.commencer('session-a', { password: 'pas-le-bon-mot-de-passe' }, '192.0.2.10'), /Mot de passe incorrect/);
  const q = await x.df.commencer('session-a', { password: OK.password }, '192.0.2.10');
  assert.match(q.secret, /^[A-Z2-7]{32}$/, 'secret base32 de 160 bits');
  assert.equal(q.uri, `otpauth://totp/Odin:sami%40example.org?secret=${q.secret}&issuer=Odin&algorithm=SHA1&digits=6&period=30`);
  assert.match(q.svg, /^<svg/);
  assert.equal(x.df.actif(), false, 'pas encore actif : aucun code confirmé');
  assert.deepEqual(x.df.etat('session-a').enAttente?.secret, q.secret, 'la même session revoit son QR code');
  assert.equal(x.df.etat('session-b').enAttente, undefined, 'une autre session ne le voit pas');
  assert.throws(() => x.df.confirmer('session-b', code(q.secret, x.at()), '192.0.2.10'), /Aucune activation en cours/, 'le QR code est lié à la session qui l\'a demandé');
  assert.throws(() => x.df.confirmer('session-a', faux(q.secret, x.at()), '192.0.2.10'), /Code incorrect/);
  assert.equal(x.df.actif(), false);
  x.df.confirmer('session-a', code(q.secret, x.at()), '192.0.2.10');
  assert.equal(x.df.actif(), true);
  assert.equal(x.df.etat('session-a').enAttente, undefined);
  assert.deepEqual(x.acc.journalDeuxFacteur().map((n) => n.quoi), ['activé']);
  // Le code de l'activation ne peut pas resservir pour entrer.
  assert.equal(x.df.verifier(code(q.secret, x.at()), '192.0.2.10').ok, false, 'le code de confirmation est déjà utilisé');
});

test('secret jamais en clair sur le disque, ni rendu par profile()', async () => {
  const x = await monter();
  const secret = await activer(x);
  const disque = toutLeDisque(x.h);
  assert.equal(disque.includes(secret), false, 'aucun fichier du dossier ne contient le secret');
  const brut = JSON.parse(readFileSync(join(x.h, 'compte.json'), 'utf8')) as { deuxFacteur: { secret: string } };
  assert.match(brut.deuxFacteur.secret, /^odc1:/, 'chiffré avec la clé de la machine');
  assert.equal(JSON.stringify(x.acc.profile()).includes('deuxFacteur'), false);
  assert.equal(JSON.stringify(x.df.etat('autre')).includes(secret), false, 'l\'état montré à la page ne contient pas le secret actif');
  assert.throws(() => x.acc.poserDeuxFacteur({ secret: 'ABCDEFGH', depuis: '', pas: 0 }), /non chiffré/, 'un secret en clair est refusé');
});

test('connexion : code juste, faux, rejoué, ±30 s, expiré', async () => {
  const x = await monter();
  const s = await activer(x);
  x.avance(30_000); // pas suivant
  assert.deepEqual(x.df.verifier(faux(s, x.at()), '192.0.2.10'), { ok: false, error: 'Code incorrect.', code: 'code_faux' });
  assert.equal(x.df.verifier(code(s, x.at()), '192.0.2.10').ok, true, 'code juste');
  const r = x.df.verifier(code(s, x.at()), '192.0.2.10');
  assert.equal(r.ok, false); assert.match((r as { error: string }).error, /déjà servi/, 'le même code ne sert pas deux fois');
  x.avance(60_000);
  assert.equal(x.df.verifier(code(s, x.at() - 30_000), '192.0.2.10').ok, true, 'code du pas d\'avant : accepté (horloge du téléphone en retard)');
  assert.equal(x.df.verifier(code(s, x.at() + 30_000), '192.0.2.10').ok, true, 'code du pas d\'après : accepté (horloge en avance)');
  assert.equal(x.df.verifier(code(s, x.at()), '192.0.2.10').ok, false, 'un code plus ancien que le dernier accepté : refusé');
  x.avance(120_000);
  assert.equal(x.df.verifier(code(s, x.at() - 60_000), '192.0.2.10').ok, false, 'code expiré (une minute) : refusé');
  assert.equal(x.df.verifier('12 34', '192.0.2.10').ok, false, 'pas 6 chiffres');
});

test('codes faux : attente croissante comptée par adresse ; une autre adresse n\'est pas bloquée', async () => {
  const x = await monter();
  const s = await activer(x);
  x.avance(30_000);
  for (let i = 0; i < 4; i++) x.df.verifier(faux(s, x.at()), '203.0.113.7');
  assert.equal(x.df.attente('203.0.113.7'), 0, '4 erreurs : pas encore d\'attente');
  x.df.verifier(faux(s, x.at()), '203.0.113.7');
  assert.equal(x.df.attente('203.0.113.7'), 30, '5 erreurs : 30 s');
  const bloque = x.df.verifier(code(s, x.at()), '203.0.113.7');
  assert.equal(bloque.ok, false); assert.equal((bloque as { attente?: number }).attente, 30, 'même un code juste attend');
  assert.equal(x.df.attente('192.0.2.10'), 0, 'l\'autre adresse n\'attend pas');
  assert.equal(x.df.verifier(code(s, x.at()), '192.0.2.10').ok, true, 'le propriétaire entre depuis son adresse');
  x.avance(31_000);
  x.df.verifier(faux(s, x.at()), '203.0.113.7');
  assert.equal(x.df.attente('203.0.113.7'), 60, 'l\'attente double');
});

test('retrait connecté : mot de passe ET code valide ; changer de téléphone pareil', async () => {
  const x = await monter();
  const s = await activer(x);
  x.avance(30_000);
  await assert.rejects(x.df.retirer({ password: 'pas-le-bon-mot-de-passe', code: code(s, x.at()) }, '192.0.2.10'), /Mot de passe incorrect/);
  await assert.rejects(x.df.retirer({ password: OK.password, code: faux(s, x.at()) }, '192.0.2.10'), /Code incorrect/);
  await assert.rejects(x.df.retirer({ password: OK.password }, '192.0.2.10'), /Code incorrect/, 'le mot de passe seul ne suffit pas');
  assert.equal(x.df.actif(), true);
  // Changer de téléphone : le nouveau QR code ne remplace l'ancien qu'après le premier code du nouveau.
  await assert.rejects(x.df.commencer('session-a', { password: OK.password }, '192.0.2.10'), /Code incorrect/, 'déjà actif : le code actuel est exigé');
  const n = await x.df.commencer('session-a', { password: OK.password, code: code(s, x.at()) }, '192.0.2.10');
  assert.notEqual(n.secret, s);
  x.avance(30_000);
  assert.equal(x.df.verifier(code(s, x.at()), '192.0.2.10').ok, true, 'l\'ancien téléphone marche encore tant que le nouveau n\'est pas confirmé');
  x.df.confirmer('session-a', code(n.secret, x.at()), '192.0.2.10');
  x.avance(30_000);
  assert.equal(x.df.verifier(code(s, x.at()), '192.0.2.10').ok, false, 'l\'ancien téléphone ne marche plus');
  await x.df.retirer({ password: OK.password, code: code(n.secret, x.at()) }, '192.0.2.10');
  assert.equal(x.df.actif(), false);
  assert.deepEqual(x.acc.journalDeuxFacteur().map((j) => j.quoi), ['activé', 'téléphone changé', 'retiré (mot de passe et code)']);
});

test('secours : lien envoyé à l\'adresse du compte, 15 min, une seule fois, avec le mot de passe', async () => {
  const x = await monter();
  await activer(x);
  const d = await x.df.demanderSecours('192.0.2.10', (j) => [`http://192.0.2.1:8080/?secours=${j}`]);
  assert.equal(d.ok, true);
  assert.equal(x.mails.length, 1); assert.equal(x.mails[0].a, OK.email, 'envoyé à l\'adresse e-mail du compte');
  const jeton = /secours=([A-Za-z0-9_-]{43})/.exec(x.mails[0].texte)![1];
  assert.equal(x.mails[0].texte.includes(OK.password), false);
  // Lien sans le bon mot de passe : refusé, le double facteur reste.
  let r = await x.df.utiliserSecours(jeton, OK.email, 'pas-le-bon-mot-de-passe', '192.0.2.10');
  assert.equal(r.ok, false); assert.equal(x.df.actif(), true);
  // Mot de passe sans lien (un autre jeton) : refusé.
  r = await x.df.utiliserSecours('A'.repeat(43), OK.email, OK.password, '192.0.2.10');
  assert.equal(r.ok, false); assert.match((r as { error: string }).error, /Lien de secours inconnu/); assert.equal(x.df.actif(), true);
  r = await x.df.utiliserSecours('', OK.email, OK.password, '192.0.2.10');
  assert.equal(r.ok, false);
  // Lien + mot de passe : le double facteur est retiré, noté.
  r = await x.df.utiliserSecours(jeton, OK.email, OK.password, '192.0.2.10');
  assert.equal(r.ok, true); assert.equal(x.df.actif(), false);
  assert.equal(x.acc.journalDeuxFacteur().at(-1)?.quoi, 'retiré par le lien de secours');
  // Lien rejoué : refusé (même réactivé entre-temps).
  await activer(x);
  r = await x.df.utiliserSecours(jeton, OK.email, OK.password, '192.0.2.10');
  assert.equal(r.ok, false); assert.equal(x.df.actif(), true, 'lien déjà utilisé');
});

test('secours : lien expiré, lien brûlé après 3 mauvais mots de passe, envoi d\'e-mail non réglé', async () => {
  const x = await monter();
  await activer(x);
  await x.df.demanderSecours('192.0.2.10', (j) => [`http://192.0.2.1:8080/?secours=${j}`]);
  let jeton = /secours=([A-Za-z0-9_-]{43})/.exec(x.mails[0].texte)![1];
  x.avance(15 * 60_000 + 1000);
  let r = await x.df.utiliserSecours(jeton, OK.email, OK.password, '192.0.2.10');
  assert.equal(r.ok, false, 'expiré après 15 minutes'); assert.equal(x.df.actif(), true);
  x.avance(2 * 60_000);
  await x.df.demanderSecours('192.0.2.10', (j) => [`http://192.0.2.1:8080/?secours=${j}`]);
  jeton = /secours=([A-Za-z0-9_-]{43})/.exec(x.mails[1].texte)![1];
  for (let i = 0; i < 3; i++) await x.df.utiliserSecours(jeton, OK.email, `faux-mot-de-passe-${i}`, '192.0.2.10');
  x.avance(5 * 60_000);
  r = await x.df.utiliserSecours(jeton, OK.email, OK.password, '192.0.2.10');
  assert.equal(r.ok, false, 'brûlé après 3 mauvais mots de passe'); assert.equal(x.df.actif(), true);
  // Sans envoi d'e-mail réglé : l'écran dit la commande de dernier recours.
  const y = await monter({ envoi: false });
  await activer(y);
  const d = await y.df.demanderSecours('192.0.2.10', (j) => [j]);
  assert.equal(d.ok, false); assert.match((d as { error: string }).error, /odin compte double-facteur retirer/);
});

test('changer le mot de passe ou l\'adresse pendant qu\'un code est accepté ne rouvre pas le rejeu', async () => {
  const x = await monter();
  const s = await activer(x);
  x.avance(30_000);
  const enCours = x.acc.changePassword(OK.password, 'un-autre-mot-de-passe-assez-long');
  assert.equal(x.df.verifier(code(s, x.at()), '192.0.2.10').ok, true, 'code accepté pendant le calcul du mot de passe');
  await enCours;
  assert.equal(x.df.verifier(code(s, x.at()), '192.0.2.10').ok, false, 'le même code reste refusé après l\'enregistrement du mot de passe');
  x.avance(30_000);
  const maj = x.acc.update({ email: 'sami2@example.org' }, 'un-autre-mot-de-passe-assez-long');
  assert.equal(x.df.verifier(code(s, x.at()), '192.0.2.10').ok, true);
  await maj;
  assert.equal(x.df.verifier(code(s, x.at()), '192.0.2.10').ok, false, 'pareil après le changement d\'adresse');
  assert.equal(x.acc.profile()?.email, 'sami2@example.org');
});

test('dernier recours sur la machine : retire le double facteur et le note', async () => {
  const x = await monter();
  await activer(x);
  assert.equal(retirerSurLaMachine(x.h), true);
  assert.equal(new Accounts(x.h).deuxFacteur(), undefined);
  assert.equal(x.acc.journalDeuxFacteur().at(-1)?.quoi, 'retiré par la commande sur la machine d\'Odin');
  assert.equal(retirerSurLaMachine(x.h), false, 'rien à retirer');
});

test('interface web : activation, code demandé à la connexion, rejeu refusé, secours par e-mail, clé d\'API refusée', async () => {
  const { Gateway } = await import('../src/bifrost/gateway.ts');
  const { WebChannel, ensureWebToken } = await import('../src/web/server.ts');
  const { makeOdin } = await import('./helpers.ts');
  const o = makeOdin([]);
  const port = 21000 + Math.floor(Math.random() * 20000);
  const token = ensureWebToken(o.paths), mails: string[] = [];
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: () => gw.scanNetwork(false) }, { port, host: '127.0.0.1', token, scryptN: 1024, envoiCourriel: async (_a: string, _s: string, t: string) => { mails.push(t); } }));
  await gw.start();
  const B = `http://127.0.0.1:${port}`;
  const post = (p: string, body: unknown, cookie = '') => fetch(`${B}${p}`, { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const sessionDe = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith('odin_session=') && !c.includes('Max-Age=0'))?.split(';')[0] ?? '';
  try {
    const made = await fetch(`${B}/api/account/create`, { method: 'POST', headers: { cookie: `odin_token=${token}`, 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify(OK) });
    assert.equal(made.status, 200);
    const s1 = sessionDe(made);
    let r = await fetch(`${B}/api/account/double-facteur`, { headers: { cookie: s1 } });
    assert.equal(r.status, 200); assert.equal(((await r.json()) as { actif: boolean }).actif, false);
    r = await post('/api/account/double-facteur/commencer', { password: OK.password }, '');
    assert.equal(r.status, 401, 'pas connecté : refusé');
    r = await fetch(`${B}/api/account/double-facteur/commencer`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ password: OK.password }) });
    assert.equal(r.status, 403, 'la clé d\'API ne règle pas le double facteur');
    r = await post('/api/account/double-facteur/commencer', {}, s1);
    assert.equal(r.status, 400, 'sans mot de passe : refusé');
    r = await post('/api/account/double-facteur/commencer', { password: OK.password }, s1);
    assert.equal(r.status, 200);
    const q = await r.json() as { secret: string; uri: string; svg: string };
    assert.match(q.uri, /^otpauth:\/\/totp\/Odin:/);
    r = await post('/api/account/double-facteur/confirmer', { code: totp(q.secret, Date.now()).code }, s1);
    assert.equal(r.status, 200);
    await post('/api/account/logout', {}, s1);
    // Connexion : le mot de passe seul ne suffit plus.
    r = await post('/api/account/login', { email: OK.email, password: OK.password });
    assert.equal(r.status, 401); assert.equal(sessionDe(r), '', 'aucune session sans le code');
    const b = await r.json() as { code: string; secours: boolean };
    assert.equal(b.code, 'code_requis'); assert.equal(b.secours, true);
    const bon = totp(q.secret, Date.now() + 30_000).code; // le pas suivant : celui de la confirmation a déjà servi
    r = await post('/api/account/login', { email: OK.email, password: OK.password, code: bon === '000000' ? '111111' : '000000' });
    assert.equal(r.status, 401); assert.equal(((await r.json()) as { code: string }).code, 'code_faux'); assert.equal(sessionDe(r), '');
    r = await post('/api/account/login', { email: OK.email, password: 'pas-le-bon-mot-de-passe', code: bon });
    assert.equal(r.status, 401); assert.equal(sessionDe(r), '', 'bon code, mauvais mot de passe : refusé');
    r = await post('/api/account/login', { email: OK.email, password: OK.password, code: bon });
    assert.equal(r.status, 200, 'mot de passe et code justes');
    const s2 = sessionDe(r); assert.ok(s2);
    r = await post('/api/account/login', { email: OK.email, password: OK.password, code: bon });
    assert.equal(r.status, 401, 'code rejoué : refusé'); assert.equal(sessionDe(r), '');
    // Secours : « J'ai perdu mon téléphone » (avec le mot de passe), puis le lien + le mot de passe.
    r = await post('/api/account/login', { email: OK.email, password: 'pas-le-bon-mot-de-passe', perdu: true });
    assert.equal(r.status, 401); assert.equal(mails.length, 0, 'pas de lien sans le bon mot de passe');
    r = await post('/api/account/login', { email: OK.email, password: OK.password, perdu: true });
    assert.equal(r.status, 200); assert.equal(((await r.json()) as { code: string }).code, 'secours_envoye');
    assert.equal(mails.length, 1);
    const jeton = /secours=([A-Za-z0-9_-]{43})/.exec(mails[0])![1];
    assert.match(mails[0], new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?secours=`), 'le lien vise une adresse connue d\'Odin');
    r = await post('/api/account/login', { email: OK.email, secours: jeton });
    assert.equal(r.status, 401); assert.equal(sessionDe(r), '', 'lien sans mot de passe : refusé');
    r = await post('/api/account/login', { email: OK.email, password: OK.password, secours: jeton });
    assert.equal(r.status, 200); const s3 = sessionDe(r); assert.ok(s3, 'lien + mot de passe : entré');
    r = await fetch(`${B}/api/account/double-facteur`, { headers: { cookie: s3 } });
    const e = await r.json() as { actif: boolean; enAttente?: { secret: string }; journal: Array<{ quoi: string }> };
    assert.equal(e.actif, false, 'double facteur retiré');
    assert.match(e.enAttente?.secret ?? '', /^[A-Z2-7]{32}$/, 'un nouveau QR code est proposé aussitôt');
    assert.equal(e.journal.at(-1)?.quoi, 'retiré par le lien de secours');
    r = await post('/api/account/login', { email: OK.email, password: OK.password, secours: jeton });
    assert.equal(r.status, 200, 'double facteur retiré : le mot de passe suffit de nouveau');
    // Le lien rejoué ne retire rien d'un double facteur réactivé.
    r = await post('/api/account/double-facteur/confirmer', { code: totp(e.enAttente!.secret, Date.now()).code }, s3);
    assert.equal(r.status, 200);
    r = await post('/api/account/login', { email: OK.email, password: OK.password, secours: jeton });
    assert.equal(r.status, 403, 'lien déjà utilisé'); assert.equal(sessionDe(r), '');
  } finally { await gw.stop(); o.cleanup(); }
});

test('codes faux depuis beaucoup d\'adresses : plafond par compte et alerte ; sessions ouvertes et lien de secours non bloqués', async () => {
  const alertes: string[] = [];
  let now = T0;
  const h = home(), acc = new Accounts(h, { scryptN: 1024, now: () => now });
  await acc.create(OK);
  const mails: string[] = [];
  const df = new DoubleFacteur(h, acc, { now: () => now, envoi: async (_a, _s, t) => { mails.push(t); }, alerte: (t) => { alertes.push(t); } });
  const q = await df.commencer('session-a', { password: OK.password }, '192.0.2.10');
  df.confirmer('session-a', code(q.secret, now), '192.0.2.10');
  now += 30_000;
  // Une adresse (forgée) par essai : l'attente par adresse ne joue jamais.
  for (let i = 0; i < 40; i++) df.verifier(faux(q.secret, now), `198.51.100.${i + 1}`);
  const v = df.verifier(code(q.secret, now), '203.0.113.99');
  assert.equal(v.ok, false, 'trop de codes faux sur le compte : même un code juste attend, d\'où qu\'il vienne');
  assert.equal((v as { code: string }).code, 'trop_d_essais');
  assert.ok(((v as { attente?: number }).attente ?? 0) > 0);
  assert.ok(df.attenteConnexion('203.0.113.99') > 0, 'la connexion attend aussi');
  assert.equal(alertes.length, 1, 'le propriétaire est prévenu une fois');
  assert.match(alertes[0], /mot de passe/);
  assert.equal(acc.journalDeuxFacteur().at(-1)?.quoi, 'codes faux en série : codes suspendus');
  // Une session déjà ouverte n'est pas bloquée (changer de téléphone, retirer).
  assert.equal(df.verifier(code(q.secret, now), '192.0.2.10', { connecte: true }).ok, true, 'session ouverte : le code passe');
  // Le lien de secours (adresse e-mail + mot de passe) reste possible.
  const d = await df.demanderSecours('192.0.2.10', (j) => [`http://192.0.2.1:8080/?secours=${j}`]);
  assert.equal(d.ok, true);
  const jeton = /secours=([A-Za-z0-9_-]{43})/.exec(mails[0])![1];
  assert.equal((await df.utiliserSecours(jeton, OK.email, OK.password, '192.0.2.10')).ok, true, 'le secours n\'est pas bloqué par l\'attente du compte');
});

test('l\'attente du compte passe, puis grandit ; une seule adresse qui se trompe ne déclenche pas le plafond', async () => {
  const alertes: string[] = [];
  let now = T0;
  const h = home(), acc = new Accounts(h, { scryptN: 1024, now: () => now });
  await acc.create(OK);
  const df = new DoubleFacteur(h, acc, { now: () => now, alerte: (t) => { alertes.push(t); } });
  const q = await df.commencer('session-a', { password: OK.password }, '192.0.2.10');
  df.confirmer('session-a', code(q.secret, now), '192.0.2.10');
  // Une seule adresse, pendant une heure : son attente à elle la freine bien avant le plafond du compte.
  for (let t = 0; t < 60 * 60_000; t += 5_000) { now += 5_000; df.verifier(faux(q.secret, now), '203.0.113.7'); }
  assert.equal(alertes.length, 0, 'une seule adresse : pas d\'alerte du compte');
  assert.equal(df.attenteConnexion('192.0.2.10'), 0, 'le propriétaire, ailleurs, n\'attend pas');
  now += 60 * 60_000;
  for (let i = 0; i < 20; i++) df.verifier(faux(q.secret, now), `198.51.100.${i + 1}`);
  const w = df.attenteConnexion('192.0.2.10');
  assert.ok(w > 0 && w <= 60, `attente courte d'abord (${w} s)`);
  now += w * 1000 + 1000;
  assert.equal(df.attenteConnexion('192.0.2.10'), 0, 'l\'attente passe');
  df.verifier(faux(q.secret, now), '198.51.100.200');
  assert.ok(df.attenteConnexion('192.0.2.10') > w, 'puis elle grandit');
  assert.equal(alertes.length, 1);
});

test('appairage : une demande acceptée n\'ouvre jamais de session du propriétaire quand le compte existe (double facteur ou non)', async () => {
  const { Gateway } = await import('../src/bifrost/gateway.ts');
  const { WebChannel, ensureWebToken } = await import('../src/web/server.ts');
  const { makeOdin } = await import('./helpers.ts');
  const o = makeOdin([]);
  const port = 21000 + Math.floor(Math.random() * 20000);
  const token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  const web = new WebChannel(o, { scanNetwork: () => gw.scanNetwork(false) }, { port, host: '127.0.0.1', token, scryptN: 1024, envoiCourriel: async () => {} });
  gw.add(web);
  await gw.start();
  const B = `http://127.0.0.1:${port}`;
  const appairage = (web as unknown as { pairing: { request(ua: string, ip: string, now?: number, device?: string): { id: string; secret: string } | undefined; decide(id: string, ok: boolean): unknown } }).pairing;
  const post = (p: string, body: unknown, h: Record<string, string> = {}) => fetch(`${B}${p}`, { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  const sessionDe = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith('odin_session=') && !c.includes('Max-Age=0'))?.split(';')[0] ?? '';
  // Une demande comme celle d'un profil de la famille (Pégase), acceptée par le propriétaire.
  const accepte = () => { const r = appairage.request('', '198.51.100.7', Date.now(), 'Pégase · Lina (lina@example.org) · Téléphone'); assert.ok(r); appairage.decide(r.id, true); return r.secret; };
  try {
    const made = await fetch(`${B}/api/account/create`, { method: 'POST', headers: { cookie: `odin_token=${token}`, 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify(OK) });
    assert.equal(made.status, 200);
    const s1 = sessionDe(made);
    // Compte sans double facteur : déjà aucune session par l'appairage.
    let r = await post('/api/pair/status', {}, { 'x-pair': accepte() });
    assert.equal(sessionDe(r), '', 'pas de session du propriétaire par l\'appairage');
    assert.equal(r.headers.getSetCookie().some((c) => c.startsWith('odin_token=') && !c.includes('Max-Age=0')), false, 'ni le jeton');
    // Double facteur actif : pareil.
    r = await post('/api/account/double-facteur/commencer', { password: OK.password }, { cookie: s1 });
    const q = await r.json() as { secret: string };
    r = await post('/api/account/double-facteur/confirmer', { code: totp(q.secret, Date.now()).code }, { cookie: s1 });
    assert.equal(r.status, 200);
    r = await post('/api/pair/status', {}, { 'x-pair': accepte() });
    const s2 = sessionDe(r);
    assert.equal(s2, '', 'double facteur actif : l\'appairage n\'ouvre pas de session');
    r = await fetch(`${B}/api/account/double-facteur`, { headers: { cookie: s2 || 'odin_session=rien' } });
    assert.ok(r.status === 401 || r.status === 403, `pas entré (${r.status})`);
  } finally { await gw.stop(); o.cleanup(); }
});

test('connexion web : codes faux depuis des adresses forgées (tunnel) : plafond du compte et propriétaire prévenu', async () => {
  const { Gateway } = await import('../src/bifrost/gateway.ts');
  const { WebChannel, ensureWebToken } = await import('../src/web/server.ts');
  const { makeOdin } = await import('./helpers.ts');
  const o = makeOdin([]);
  const port = 21000 + Math.floor(Math.random() * 20000);
  const token = ensureWebToken(o.paths), dits: string[] = [];
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: () => gw.scanNetwork(false), tellOwner: async (t: string) => { dits.push(t); } }, { port, host: '127.0.0.1', token, scryptN: 1024, envoiCourriel: async () => {} }));
  await gw.start();
  const B = `http://127.0.0.1:${port}`;
  const post = (p: string, body: unknown, h: Record<string, string> = {}) => fetch(`${B}${p}`, { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  try {
    const made = await fetch(`${B}/api/account/create`, { method: 'POST', headers: { cookie: `odin_token=${token}`, 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify(OK) });
    const s1 = made.headers.getSetCookie().find((c) => c.startsWith('odin_session='))!.split(';')[0];
    let r = await post('/api/account/double-facteur/commencer', { password: OK.password }, { cookie: s1 });
    const q = await r.json() as { secret: string };
    r = await post('/api/account/double-facteur/confirmer', { code: totp(q.secret, Date.now()).code }, { cookie: s1 });
    assert.equal(r.status, 200);
    const bon = totp(q.secret, Date.now() + 30_000).code, mauvais = bon === '000000' ? '111111' : '000000';
    const statuts: number[] = [];
    for (let i = 0; i < 30; i++) statuts.push((await post('/api/account/login', { email: OK.email, password: OK.password, code: mauvais }, { 'x-forwarded-for': `198.51.100.${i + 1}` })).status);
    assert.ok(statuts.includes(429), `les codes faux finissent par attendre (${statuts.join(',')})`);
    r = await post('/api/account/login', { email: OK.email, password: OK.password, code: bon }, { 'x-forwarded-for': '203.0.113.50' });
    assert.equal(r.status, 429, 'une nouvelle adresse attend aussi');
    assert.equal(dits.filter((t) => /codes faux/.test(t)).length, 1, 'le propriétaire est prévenu une fois');
    r = await fetch(`${B}/api/account/double-facteur`, { headers: { cookie: s1 } });
    assert.equal(r.status, 200, 'la session déjà ouverte n\'est pas touchée');
    r = await post('/api/account/login', { email: OK.email, password: OK.password, perdu: true }, { 'x-forwarded-for': '203.0.113.50' });
    assert.equal(((await r.json()) as { code: string }).code, 'secours_envoye', '« J\'ai perdu mon téléphone » reste possible pendant l\'attente');
  } finally { await gw.stop(); o.cleanup(); }
});

test('écran de connexion : la consigne et le lien parti s\'affichent comme une information, pas comme une erreur', () => {
  const ui = readFileSync(join(import.meta.dirname, '..', 'src', 'web', 'ui.html'), 'utf8');
  assert.match(ui, /<[a-z]+[^>]*id="siInfo"[^>]*role="status"|<[a-z]+[^>]*role="status"[^>]*id="siInfo"/, 'une ligne d\'information à part (role=status)');
  assert.match(ui, /'secours_envoye'\) siInfo\(r\.error\)/, 'le lien parti va dans la ligne d\'information');
  assert.match(ui, /code_requis[^\n]*siInfo\(r\.error\)/, 'la consigne du code va dans la ligne d\'information');
  assert.doesNotMatch(ui, /\$\('#siPerdu'\)\.disabled = false; \$\('#siErr'\)\.textContent = r\.error/, 'la réussite n\'est plus écrite dans la ligne d\'erreur');
});

test('Réglages, carte du double facteur : le statut juste sous les boutons, le journal après ; après le lien de secours, le texte le dit', () => {
  const ui = readFileSync(join(import.meta.dirname, '..', 'src', 'web', 'ui.html'), 'utf8');
  assert.match(ui, /el\('div', \{ id: 'ac-2fa'[^\n]*\n\s*F\.status\('df-st'\),\n\s*el\('div', \{ id: 'ac-2fa-j'/, 'ordre : carte, statut, puis journal');
  assert.match(ui, /retiré par le lien de secours[^\n]*\n?[^\n]*mot de passe seul/, 'après le secours : le double facteur est retiré, le mot de passe seul protège jusqu\'au premier code');
  assert.match(ui, /class: 'btn danger'[^\n]*Retirer le double facteur|Retirer le double facteur[^\n]*'btn danger'/, 'retirer : bouton marqué danger');
});
