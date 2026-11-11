// Le compte du propriétaire : création, mot de passe, sessions, blocage après erreurs.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Accounts, SESSION_IDLE_MS, SESSION_MAX_MS, passwordProblem, passwordStrength, validEmail } from '../src/web/account.ts';

const home = () => mkdtempSync(join(tmpdir(), 'odin-compte-'));
const OK = { prenom: 'Awa', nom: 'Saïd', email: 'Awa@Exemple.yt', password: 'un-cheval-bleu-traverse-mamoudzou' };

test('mot de passe : longueur d\'abord, refus des classiques et de ce qui ressemble au nom', () => {
  assert.match(passwordProblem('court') ?? '', /au moins 10/);
  assert.match(passwordProblem('Password123!') ?? '', /plus essayés/);
  assert.match(passwordProblem('azertyuiop') ?? '', /plus essayés/);
  assert.match(passwordProblem('aaaaaaaaaaaa') ?? '', /répète/);
  assert.match(passwordProblem('Awasaid2026', { prenom: 'Awa', nom: 'Saïd', email: 'awasaid@exemple.yt' }) ?? '', /ressemble/);
  assert.equal(passwordProblem('un-cheval-bleu-traverse-mamoudzou', OK), undefined);
  assert.equal(passwordProblem('x'.repeat(201)) !== undefined, true);
  assert.ok(passwordStrength('un-cheval-bleu-traverse-mamoudzou') >= 3);
  assert.equal(passwordStrength('abc'), 1);
});

test('adresse e-mail : forme vérifiée', () => {
  for (const ok of ['a@b.yt', 'prenom.nom+odin@exemple.co.uk']) assert.equal(validEmail(ok), true, ok);
  for (const bad of ['', 'a', 'a@b', 'a b@c.fr', 'a@b.c', '<a@b.fr>', `${'x'.repeat(250)}@b.fr`]) assert.equal(validEmail(bad), false, bad);
});

test('création du compte : une seule fois, données vérifiées, rien en clair sur le disque', async () => {
  const h = home(), acc = new Accounts(h, { scryptN: 1024 });
  assert.equal(acc.exists(), false);
  await assert.rejects(acc.create({ ...OK, prenom: '' }), /prénom/);
  await assert.rejects(acc.create({ ...OK, nom: ' ' }), /nom/);
  await assert.rejects(acc.create({ ...OK, email: 'pas-une-adresse' }), /e-mail/);
  await assert.rejects(acc.create({ ...OK, password: '12345678' }), /au moins 10/);
  assert.equal(acc.exists(), false, 'rien n\'est créé tant qu\'une donnée est fausse');
  const p = await acc.create({ ...OK, prenom: '  Awa <script> ' });
  assert.deepEqual([p.prenom, p.nom, p.email], ['Awa script', 'Saïd', 'awa@exemple.yt'], 'nom nettoyé, e-mail en minuscules');
  assert.equal(acc.exists(), true);
  await assert.rejects(acc.create(OK), /existe déjà/);
  const raw = readFileSync(join(h, 'compte.json'), 'utf8');
  assert.equal(raw.includes(OK.password), false, 'le mot de passe n\'est jamais écrit');
  assert.match(raw, /"algo": "scrypt"/);
  if (process.platform !== 'win32') assert.equal(statSync(join(h, 'compte.json')).mode & 0o777, 0o600, 'fichier lisible par le propriétaire seulement');
});

test('connexion : bon couple seulement, message qui ne dit pas ce qui est faux, attente après 5 erreurs', async () => {
  let now = 1_700_000_000_000;
  const acc = new Accounts(home(), { scryptN: 1024, now: () => now });
  assert.deepEqual(await acc.login(OK.email, OK.password), { ok: false, error: 'Adresse e-mail ou mot de passe incorrect.' }, 'sans compte : même réponse');
  await acc.create(OK);
  assert.deepEqual(await acc.login('AWA@exemple.yt ', OK.password), { ok: true }, 'e-mail sans tenir compte de la casse ni des espaces');
  const wrongPass = await acc.login(OK.email, 'mauvais-mot-de-passe'), wrongMail = await acc.login('autre@exemple.yt', OK.password);
  assert.deepEqual(wrongPass, wrongMail, 'même message pour un mauvais e-mail et un mauvais mot de passe');
  for (let i = 0; i < 3; i++) await acc.login(OK.email, `faux-${i}-xxxxxxxx`);
  assert.equal(acc.waitSeconds(), 30, '5 erreurs de suite : 30 s d\'attente');
  const blocked = await acc.login(OK.email, OK.password);
  assert.equal(blocked.ok, false); assert.match((blocked as { error: string }).error, /Trop d'essais/);
  now += 31_000;
  await acc.login(OK.email, 'encore-faux-xxxxx');
  assert.equal(acc.waitSeconds(), 60, 'l\'attente double');
  now += 61_000;
  assert.deepEqual(await acc.login(OK.email, OK.password), { ok: true }, 'le bon mot de passe remet le compteur à zéro');
  assert.equal(acc.waitSeconds(), 0);
});

test('sessions : identifiant secret, seule son empreinte est gardée, expiration et fermeture', async () => {
  let now = 1_700_000_000_000;
  const h = home(), acc = new Accounts(h, { scryptN: 1024, now: () => now });
  assert.equal(acc.valid('x'.repeat(43)), false, 'pas de compte : aucune session');
  await acc.create(OK);
  const a = acc.open({ device: 'Chrome sur Android', ip: '192.168.1.20', via: 'mot de passe' }), b = acc.open({ device: 'Safari sur iPhone', ip: '192.168.1.21', via: 'mot de passe' });
  assert.equal(a.length, 43); assert.notEqual(a, b);
  assert.equal(readFileSync(join(h, 'sessions.json'), 'utf8').includes(a), false, 'l\'identifiant n\'est pas sur le disque');
  assert.equal(acc.valid(a), true); assert.equal(acc.valid(b), true);
  assert.equal(acc.valid(`${a.slice(0, 42)}${a[42] === 'A' ? 'B' : 'A'}`), false, 'un caractère de différence : refusé');
  const list = acc.sessions(a);
  assert.equal(list.length, 2); assert.equal(list[0].current, true); assert.equal(list[0].device, 'Chrome sur Android');
  assert.equal(acc.revoke(list[1].id), true); now += 3000;
  assert.equal(acc.valid(b), false, 'session fermée à distance');
  now += SESSION_IDLE_MS + 1000;
  assert.equal(acc.valid(a), false, '30 jours sans visite : expirée');
  const c2 = acc.open({ device: 'd', ip: 'i', via: 'mot de passe' });
  for (let d = 0; d < 95; d++) { now += 86_400_000; if (now - 1_700_000_000_000 < SESSION_IDLE_MS + SESSION_MAX_MS) acc.valid(c2); }
  assert.equal(acc.valid(c2), false, '90 jours au plus, même utilisée tous les jours');
  const d2 = acc.open({ device: 'd', ip: 'i', via: 'mot de passe' }); acc.close(d2); now += 3000;
  assert.equal(acc.valid(d2), false, 'déconnexion');
});

test('changer le mot de passe : l\'actuel est exigé, les autres appareils sont déconnectés', async () => {
  let now = 1_700_000_000_000;
  const acc = new Accounts(home(), { scryptN: 1024, now: () => now });
  await acc.create(OK);
  const mine = acc.open({ device: 'moi', ip: '1', via: 'mot de passe' }), other = acc.open({ device: 'autre', ip: '2', via: 'mot de passe' });
  await assert.rejects(acc.changePassword('pas-le-bon-xxxxx', 'nouveau-mot-de-passe-long', mine), /actuel est incorrect/);
  await assert.rejects(acc.changePassword(OK.password, 'court', mine), /au moins 10/);
  await assert.rejects(acc.changePassword(OK.password, OK.password, mine), /identique/);
  await acc.changePassword(OK.password, 'nouveau-mot-de-passe-long', mine); now += 3000;
  assert.equal(acc.valid(mine), true); assert.equal(acc.valid(other), false);
  assert.equal((await acc.login(OK.email, OK.password)).ok, false, 'l\'ancien mot de passe ne marche plus');
  assert.equal((await acc.login(OK.email, 'nouveau-mot-de-passe-long')).ok, true);
  await assert.rejects(acc.update({ email: 'nouveau@exemple.yt' }, 'faux-faux-faux'), /Mot de passe incorrect/);
  const p = await acc.update({ email: 'nouveau@exemple.yt', prenom: 'Awa-Marie' }, 'nouveau-mot-de-passe-long');
  assert.deepEqual([p.prenom, p.email], ['Awa-Marie', 'nouveau@exemple.yt']);
  acc.reset(); assert.equal(acc.exists(), false); assert.equal(acc.valid(mine), false);
});
