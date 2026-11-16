// Kéryx — l'authentification à deux crans : liste blanche (numéro connu) et code secret (empreinte scrypt, comparaison
// en temps constant), avec TTL de la preuve et verrou anti-force-brute. UN FICHIER À LA FOIS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _reinitialiser, _tailleSessions, estConnu, normaliser, plafond, poserSecret, prouverSecret, secretPose, session, tropVite, TTL_PREUVE, verrouillee } from '../src/valhalla/keryx/auth.ts';
import { gererEntrant } from '../src/valhalla/keryx/canal.ts';
import type { Inbound } from '../src/bifrost/channel.ts';
import type { ReglagesKeryx } from '../src/valhalla/keryx/types.ts';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'keryx-auth-'));
const reglages = (numeros: string[]): ReglagesKeryx => ({ ligne: 'aucune', numeros, autonomieApresSecret: 'equilibre', actionGraveParAppel: 'interdite', surveillances: [] });
const inb = (peer: string, text: string): Inbound => ({ channel: 'keryx', peer, name: 'moi', text });

test('liste blanche : un numéro connu est reconnu, normalisé ; un inconnu n\'obtient rien', () => {
  assert.ok(estConnu(['+33 6 12 34 56 78'], '+33612345678'), 'espaces ignorés');
  assert.ok(estConnu(['123456789'], '123456789'), 'identifiant Telegram');
  assert.ok(!estConnu(['+33612345678'], '+33699999999'), 'autre numéro');
  assert.equal(normaliser('+33 6.12-34(56)78'), '+33612345678');
});

test('code secret : prudent avant preuve, bon code accepté, preuve expirée redevient prudent', () => {
  _reinitialiser();
  const home = tmp();
  try {
    assert.equal(secretPose(home), false);
    poserSecret(home, 'Soleil-42!');
    assert.equal(secretPose(home), true);
    const s = session('keryx', '+33612345678'); s.connu = true;
    assert.equal(plafond(s, 'autonome'), 'prudent', 'prudent tant que non prouvé');
    assert.equal(prouverSecret(home, s, 'mauvais'), false);
    assert.equal(s.secretProuve, false);
    assert.equal(prouverSecret(home, s, 'Soleil-42!'), true);
    assert.equal(s.secretProuve, true);
    assert.equal(plafond(s, 'autonome'), 'autonome', 'plafond relevé selon le réglage');
    assert.equal(plafond(s, 'autonome', Date.now() + TTL_PREUVE + 1), 'prudent', 'la preuve expire');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('anti-force-brute : verrou après plusieurs échecs, le bon code reste bloqué pendant le verrou', () => {
  _reinitialiser();
  const home = tmp();
  try {
    poserSecret(home, 'bon-code-123');
    const s = session('keryx', 'peerX'); s.connu = true;
    for (let i = 0; i < 3; i++) assert.equal(prouverSecret(home, s, `faux-${i}`), false);
    assert.ok(verrouillee(s) > 0, 'verrouillé après le seuil');
    assert.equal(prouverSecret(home, s, 'bon-code-123'), false, 'bloqué malgré le bon code');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('sans secret posé : rien ne prouve, le plafond reste prudent', () => {
  _reinitialiser();
  const home = tmp();
  try {
    const s = session('keryx', 'p');
    assert.equal(prouverSecret(home, s, 'quoiquecesoit'), false);
    assert.equal(plafond(s), 'prudent');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('pas de fuite mémoire : un flot de pairs INCONNUS ne crée aucune session gardée', () => {
  // Régression du défaut : session() était appelée AVANT le filtrage, donc chaque numéro usurpé créait une entrée Map
  // jamais libérée. Un inconnu ne doit matérialiser AUCUN état durable.
  _reinitialiser();
  const home = tmp();
  try {
    const r = reglages(['+33600000000']); // un seul connu
    for (let i = 0; i < 5000; i++) gererEntrant(home, r, inb(`+3360999${i}`, 'coucou'));
    assert.equal(_tailleSessions(), 0, 'aucune session gardée pour des inconnus');
    // Un pair CONNU, lui, est suivi (une seule entrée).
    gererEntrant(home, r, inb('+33600000000', 'bonjour'));
    assert.equal(_tailleSessions(), 1, 'le pair connu est suivi');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('débit : au-delà de N messages/minute par pair, les suivants sont rejetés (anti-inondation)', () => {
  _reinitialiser();
  const t0 = Date.now();
  let acceptes = 0;
  for (let i = 0; i < 25; i++) if (!tropVite('keryx', 'flood', t0)) acceptes++;
  assert.equal(acceptes, 20, '20 messages/minute acceptés, le reste rejeté');
  // Un AUTRE pair n'est pas pénalisé.
  assert.equal(tropVite('keryx', 'autre', t0), false);
  // La fenêtre glisse : une minute plus tard, le pair repart de zéro.
  assert.equal(tropVite('keryx', 'flood', t0 + 61_000), false);
});
