// S8 (U6) — Aucun secret en clair : une clé collée est retirée AVANT l'enregistrement et le modèle, rangée au coffre,
// et Odin le dit ; dans un mail lu, un code à usage unique ou un lien de réinitialisation est masqué.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as loadCoffre } from '../src/valhalla/modules/brisingamen.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { makeOdin } from './helpers.ts';
import { extraireCles, masquerCodes } from '../src/heimdall/redact.ts';
import { Heimdall } from '../src/heimdall/policy.ts';
import { deciderPuisLancer } from '../src/heimdall/executer.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

class FakeChannel implements Channel {
  readonly name = 'fake';
  readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}
const CLE = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

test('coller une clé : ni l\'historique ni le message envoyé au modèle ne la contiennent ; rangée au coffre ; Odin le dit', async () => {
  // La clé va au coffre (Thésauros), et nulle part ailleurs : plus de fichier à part des clés reçues
  // (secrets-cles-recues.json), qui en gardait une copie hors du coffre. Décision du propriétaire (19/11, demandes du
  // 17/11, section 89) : « il met dans son coffre, il supprime du chat automatiquement tous les clés […] il les supprime
  // les conserves nulle part et le mettre directement dans le coffre » ; et « le mot de passe est dans le coffre et
  // supprimer du texte ».
  const cleAvant = process.env.BRISINGAMEN_KEY;
  process.env.BRISINGAMEN_KEY = randomBytes(32).toString('hex');
  const o = makeOdin([{ text: 'noté' }]);
  try {
    const ch = new FakeChannel();
    const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
    await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `voici ma clé OpenAI ${CLE} garde-la` });
    assert.ok(o.provider.calls.length >= 1);
    assert.doesNotMatch(JSON.stringify(o.provider.calls), new RegExp(CLE));
    const hist = o.muninn.history('fake:boss').map((x) => x.content).join('\n');
    assert.doesNotMatch(hist, new RegExp(CLE)); assert.match(hist, /\[rangé au coffre : [^\]]+\]/);
    assert.ok(ch.sent.some((x) => /J'ai rangé au coffre/.test(x.text)), JSON.stringify(ch.sent.map((x) => x.text)));
    assert.ok(!readdirSync(o.paths.home).some((f) => f.startsWith('secrets-cles-recues.json')), 'aucune copie hors du coffre');
    assert.ok(loadCoffre({ dir: join(o.paths.home, 'valhalla', 'brisingamen') } as never).some((i) => Object.values({ ...(i.champs ?? {}), p: i.password ?? '' }).includes(CLE)), 'rangée au coffre');
    assert.equal(o.redactor.redact(`x ${CLE}`), 'x [SECRET]');
  } finally { o.cleanup(); if (cleAvant === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = cleAvant; }
});

test('un mail « Votre code : 482913 » : mail_read ne montre pas 482913 ; un lien de réinitialisation non plus ; le reste ne change pas', async () => {
  const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async () => true });
  const mailRead = { name: 'mail_read', description: '', risk: 'read' as const, schema: { type: 'object', properties: {} }, async run() { return 'De : banque\nVotre code de connexion : 482913\nRéinitialiser : https://banque.fr/reset?token=abc\nRendez-vous le 12/11 à 14 h, 49,90 €.'; } } as never;
  const r = await deciderPuisLancer(h, mailRead, {}, { workspace: tmpdir(), sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never, { sessionId: 's', tainted: false });
  const out = String(await r.lancer!());
  assert.doesNotMatch(out, /482913/); assert.match(out, /code de connexion reçu — masqué/);
  assert.doesNotMatch(out, /token=abc/);
  assert.match(out, /Rendez-vous le 12\/11 à 14 h, 49,90 €/);
  assert.equal(masquerCodes('Le marché ouvre à 6 h'), 'Le marché ouvre à 6 h');
  assert.deepEqual(extraireCles('rien de secret ici').cles, []);
});

// ---------------------------------------------------------------------------------------------------------------
// Le tri des secrets entrants (src/heimdall/secrets-entrants.ts) : fonction pure, pas encore branchée. Aucune vraie
// valeur ici : tout est construit à l'exécution (graine fixe), pour ne ressembler à aucune vraie clé.
const tri = await import('../src/heimdall/secrets-entrants.ts');
const { createHash } = await import('node:crypto');

function alea(graine: number) { let a = graine >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r = alea(1911);
const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const tirer = (n: number, a = ALNUM) => Array.from({ length: n }, () => a[Math.floor(r() * a.length)]).join('');
/** Un mot de passe inventé : lettres, chiffre, signe. */
const mdp = () => `Q${tirer(6)}7#${tirer(2, 'xyz')}`;
const lettres = (n: number) => tirer(n, 'abcdefghijkmnopqrstuvwxyz');
function carteInventee(): string {
  const corps = '4' + tirer(14, '0123456789');
  for (let d = 0; d < 10; d++) if (tri.luhn(corps + d)) return (corps + d).replace(/(\d{4})(?=\d)/g, '$1 ');
  throw new Error('impossible');
}
function luhnSansGroupes(): string { const c = '5' + tirer(14, '0123456789'); for (let d = 0; d < 10; d++) if (tri.luhn(c + d)) return c + d; throw new Error('impossible'); }
function ibanInvente(): string {
  const bban = tirer(23, '0123456789');
  const num = (s: string) => [...s].map((c) => (c >= 'A' ? String(c.charCodeAt(0) - 55) : c)).join('');
  let reste = 0; for (const d of num(bban + 'FR00')) reste = (reste * 10 + Number(d)) % 97;
  return `FR${String(98 - reste).padStart(2, '0')}${bban}`.replace(/(.{4})(?=.)/g, '$1 ');
}
function phraseInventee(): string {
  const ent = Buffer.from(Array.from({ length: 16 }, () => Math.floor(r() * 256))), h = createHash('sha256').update(ent).digest();
  const bits = [...ent].map((b) => b.toString(2).padStart(8, '0')).join('') + h[0].toString(2).padStart(8, '0').slice(0, 4);
  return Array.from({ length: 12 }, (_, i) => tri.LISTE_BIP39[parseInt(bits.slice(i * 11, i * 11 + 11), 2)]).join(' ');
}
/** Ni la valeur, ni aucun de ses morceaux de 5 caractères, dans le texte rendu. */
function absente(texte: string, v: string) {
  assert.ok(!texte.includes(v), `valeur restée dans : ${texte}`);
  if (v.length >= 6) for (let i = 0; i + 5 <= v.length; i++) assert.ok(!texte.includes(v.slice(i, i + 5)), `morceau « ${v.slice(i, i + 5)} » resté`);
}

test('tri, niveau 1 : les formes sûres sont toutes retirées, nommées, « sûres » ; aucun morceau ne reste', () => {
  const cles = {
    openai: `sk-${'proj'}-Ab1${tirer(40)}`, github: `gh${'p'}_${tirer(36)}`, aws: `AK${'IA'}${tirer(16, 'ABCDEFGHJKLMNPQRSTUVWXYZ234567')}`,
    telegram: `${tirer(9, '123456789')}:${tirer(35)}`, jwt: `eyJ${tirer(20)}.eyJ${tirer(30)}.${tirer(40)}`, bearer: tirer(32),
    cle: `-----BEGIN ${'PRIVATE'} KEY-----\n${tirer(64)}\n${tirer(64)}\n-----END ${'PRIVATE'} KEY-----`,
    url: mdp(), wifi: mdp(), otp: tirer(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), env: mdp(), json: mdp(),
    carte: carteInventee(), iban: ibanInvente(), phrase: phraseInventee(), coffre: mdp(),
  };
  const sel = tirer(16);
  const texte = [
    `voici ma clé ${cles.openai} et le jeton ${cles.github}`, `accès ${cles.aws}`, `le robot : ${cles.telegram}`, `jeton ${cles.jwt}`,
    `Authorization: Bearer ${cles.bearer}`, cles.cle, `base : postgres://lea:${cles.url}@db.example.org/base`,
    `WIFI:T:WPA;S:Maison;P:${cles.wifi};;`, `otpauth://totp/Exemple:compte?secret=${cles.otp}&issuer=Exemple`,
    `MQTT_PASSWORD=${cles.env}`, `{"password": "${cles.json}"}`, `ma carte ${cles.carte}`, `IBAN ${cles.iban}`,
    `les mots : ${cles.phrase}`, `et ${cles.coffre} encore`,
  ].join('\n');
  const res = tri.trierSecrets(texte, { coffre: { sel, valeurs: [{ empreinte: tri.empreinteSecret(cles.coffre, sel), nom: 'Imprimante', champ: 'mot de passe' }] } });
  for (const v of [...Object.values(cles), 'lea']) absente(res.texte, v);
  const par = (v: string) => res.secrets.find((s) => s.valeur === v);
  for (const [k, v] of Object.entries(cles)) { const s = par(v); assert.ok(s, `${k} non reconnu`); assert.equal(s.niveau, 1, k); assert.equal(s.sur, true, k); }
  assert.equal(par(cles.openai)?.nom, 'OpenAI'); assert.equal(par(cles.github)?.nom, 'GitHub'); assert.equal(par(cles.aws)?.nom, 'AWS');
  assert.equal(par(cles.telegram)?.nom, 'Telegram'); assert.equal(par(cles.url)?.nom, 'db.example.org'); assert.equal(par('lea')?.champ, 'identifiant');
  assert.equal(par(cles.wifi)?.nom, 'Wi-Fi Maison'); assert.equal(par(cles.otp)?.nom, 'Exemple'); assert.equal(par(cles.env)?.nom, 'MQTT_PASSWORD');
  assert.equal(par(cles.env)?.champ, 'mot de passe'); assert.equal(par(cles.carte)?.champ, 'carte bancaire'); assert.equal(par(cles.iban)?.champ, 'IBAN');
  assert.equal(par(cles.phrase)?.champ, 'phrase de récupération'); assert.equal(par(cles.coffre)?.nom, 'Imprimante');
  assert.match(res.texte, /\[rangé au coffre : Wi-Fi Maison — clé Wi-Fi\]/);
  for (const s of res.secrets) for (const v of Object.values(cles)) assert.ok(!s.nom.includes(v), 'un nom contient une valeur');
});

test('tri, niveau 2 : un secret annoncé, en plusieurs langues, est retiré ; le nom vient de la phrase', () => {
  const cas: Array<[(v: string) => string, string, string | undefined, () => string]> = [
    [(v) => `Le mot de passe de la box est ${v}, merci`, 'mot de passe', 'Box', mdp],
    [(v) => `mdp : ${v}`, 'mot de passe', undefined, () => lettres(9)],
    [(v) => `the wifi password is ${v}.`, 'clé Wi-Fi', 'Wi-Fi', mdp],
    [(v) => `la contraseña del router es ${v}`, 'mot de passe', 'Routeur', mdp],
    [(v) => `Das Passwort lautet ${v}`, 'mot de passe', undefined, mdp],
    [(v) => `la password è ${v}`, 'mot de passe', undefined, mdp],
    [(v) => `a senha é ${v}`, 'mot de passe', undefined, mdp],
    [(v) => `كلمة المرور: ${v}`, 'mot de passe', undefined, mdp],
    [(v) => `nenosiri ni ${v}`, 'mot de passe', undefined, mdp],
    [(v) => `パスワードは${v}です`, 'mot de passe', undefined, mdp],
    [(v) => `密码是${v}`, 'mot de passe', undefined, mdp],
    [(v) => `비밀번호는 ${v}`, 'mot de passe', undefined, mdp],
    [(v) => `пароль: ${v}`, 'mot de passe', undefined, mdp],
    [(v) => `tenimiafina: ${v}`, 'mot de passe', undefined, mdp],
    [(v) => `le code PIN de la carte : ${v}`, 'code PIN', undefined, () => tirer(4, '0123456789')],
    [(v) => `digicode ${v} pour entrer`, 'digicode', undefined, () => `${tirer(4, '0123456789')}B`],
    [(v) => `identifiant : ${v}`, 'identifiant', undefined, () => `${lettres(5)}.${lettres(6)}`],
    [(v) => `the API key is ${v}`, 'clé d\'API', undefined, () => `${tirer(24)}9`],
  ];
  for (const [phrase, champ, nom, valeur] of cas) {
    const v = valeur(), res = tri.trierSecrets(phrase(v), { maintenant: new Date(2026, 10, 19, 14, 32) });
    const s = res.secrets.find((x) => x.valeur === v);
    assert.ok(s, `non reconnu : ${phrase('…')}`);
    assert.equal(s.champ, champ, phrase('…')); assert.equal(s.niveau, 2); assert.equal(s.sur, true);
    if (nom) assert.equal(s.nom, nom, phrase('…')); else assert.ok(s.nom.length > 0);
    absente(res.texte, v);
  }
  assert.equal(tri.trierSecrets(`mdp : ${mdp()}`, { maintenant: new Date(2026, 10, 19, 14, 32) }).secrets[0].nom, 'Reçu le 2026-11-19 à 14:32');
});

test('tri : TOUS les secrets d\'un message, avec leurs paires « identifiant / mot de passe »', () => {
  const a = mdp(), b = mdp(), pin = tirer(4, '0123456789'), c = mdp(), d = mdp();
  const res = tri.trierSecrets(`mot de passe du wifi : ${a}, et le mot de passe de la box : ${b} ; code PIN ${pin}\nlogin/pass : admin/${c}\nuser: lea pass: ${d}`);
  for (const v of [a, b, pin, c, d]) absente(res.texte, v);
  const par = (v: string) => res.secrets.find((s) => s.valeur === v);
  assert.equal(par(a)?.nom, 'Wi-Fi'); assert.equal(par(b)?.nom, 'Box'); assert.equal(par(pin)?.champ, 'code PIN');
  assert.equal(par('admin')?.champ, 'identifiant'); assert.equal(par(c)?.champ, 'mot de passe');
  assert.equal(par('lea')?.champ, 'identifiant'); assert.equal(par(d)?.champ, 'mot de passe');
  assert.ok(res.secrets.every((s) => s.niveau === 2 && s.sur));
  assert.match(res.texte, /^mot de passe du wifi : \[rangé au coffre : Wi-Fi — mot de passe\], et le mot de passe de la box : \[rangé au coffre : Box — mot de passe\]/);
});

test('tri, niveau 3 : d\'après la conversation (question d\'Odin, sujet nommé) ; classé « probable »', () => {
  const v = mdp();
  let res = tri.trierSecrets(`  ${v}  `, { questionOdin: 'Quel est le mot de passe de la box ?' });
  assert.deepEqual(res.secrets, [{ nom: 'Box', champ: 'mot de passe', valeur: v, niveau: 3, sur: false }]);
  assert.equal(res.texte.trim(), '[rangé au coffre : Box — mot de passe]');
  const w = mdp();
  res = tri.trierSecrets(`admin ${w}`, { questionOdin: 'Donne-moi l\'identifiant et le mot de passe du routeur' });
  assert.deepEqual(res.secrets.map((s) => [s.nom, s.champ, s.valeur, s.sur]), [['Routeur', 'identifiant', 'admin', false], ['Routeur', 'mot de passe', w, false]]);
  res = tri.trierSecrets(`c'est ${w}`, { questionOdin: 'Tu peux m\'envoyer le code wifi ?' });
  assert.equal(res.secrets[0]?.valeur, w); assert.equal(res.texte, 'c\'est [rangé au coffre : Wi-Fi — mot de passe]');
  res = tri.trierSecrets(`box : admin / ${w}`);
  assert.deepEqual(res.secrets.map((s) => [s.nom, s.champ, s.valeur, s.niveau]), [['Box', 'identifiant', 'admin', 3], ['Box', 'mot de passe', w, 3]]);
  absente(res.texte, w);
  res = tri.trierSecrets(`admin / ${w}`, { derniersMessages: ['On règle la box ce soir ?', 'Oui, envoie les codes.'] });
  assert.equal(res.secrets[1]?.nom, 'Box'); absente(res.texte, w);
  // Sans sujet, sans question : rien n'est deviné (limite assumée) ; une réponse qui n'en est pas une n'est pas prise.
  assert.equal(tri.trierSecrets(`admin / ${w}`).secrets.length, 0);
  for (const rep of ['je ne sais pas', 'pourquoi ?', 'non', 'attends']) assert.equal(tri.trierSecrets(rep, { questionOdin: 'Quel est le mot de passe de la box ?' }).secrets.length, 0, rep);
  assert.equal(tri.trierSecrets(lettres(8), { questionOdin: 'Il fait beau chez toi aujourd\'hui ?' }).secrets.length, 0);
});

test('tri, corpus négatif : téléphones, dates, montants, adresses, commandes, versions, phrases sur le mot de passe restent lisibles', () => {
  const invalide = (() => { const i = ibanInvente(); return i.slice(0, -1) + String((Number(i.at(-1)) + 1) % 10); })();
  const pasLuhn = (() => { const c = luhnSansGroupes(); return c.slice(0, -1) + String((Number(c.at(-1)) + 1) % 10); })();
  const phrases = [
    '+33 6 12 34 56 78', 'Appelle le +269 321 45 67 demain', '0639 12 34 56', 'Rendez-vous le 19/11/2026 à 14h30', 'le 2026-11-19 à 14:30',
    'Total : 1 234 567,89 €', '49,90 EUR', '12 rue des Lilas, 75000', `commande ${luhnSansGroupes()}`, `numéro ${pasLuhn}`, 'Node 26.0.0 et v2.4.1',
    'j\'ai oublié mon mot de passe', 'mot de passe oublié ?', 'Le mot de passe est trop court', 'Change ton mot de passe', 'I forgot my password',
    'The password is wrong', 'Olvidé mi contraseña', 'Passwort vergessen', 'Quel est le mot de passe du wifi ?', 'Mon code postal est 75000',
    'Le colis 6A12345678901 arrive', 'I am able to access the account about the above matter today', 'Voir src/heimdall/redact.ts',
    'https://example.org/page?id=42', 'Écris à lea@example.org', '90 km/h', 'ouvert 24h/24', 'la box et/ou le routeur', `IBAN ${invalide}`,
    'la box est en panne depuis hier', 'mot de passe : voir ci-dessous', 'nenosiri: nimesahau', 'Pin the photo 2024 on the board',
    'abandon '.repeat(12).trim(), 'Le wifi marche 2/3 du temps', 'mot de passe : toujours le même', 'mon identifiant est obligatoire',
    'le token: 1500', 'clé : sous le pot', 'pwd /home/lea', 'Ma box : 1 Gb/s descendant',
  ];
  for (const p of phrases) {
    const res = tri.trierSecrets(p);
    assert.deepEqual(res.secrets, [], `pris à tort : ${p} → ${JSON.stringify(res.secrets.map((s) => s.champ))}`);
    assert.equal(res.texte, p);
  }
});

test('tri, bornes : textes piégés de 100 000 caractères traités vite (pas de retour arrière catastrophique) ; au-delà de la borne, rien ne passe', () => {
  const n = 100_000, rep = (s: string) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
  const pieges = ['a', 'mdp ', 'mot de passe : ', 'mdp' + ' '.repeat(10), '1 ', '2222 ', 'sk-', 'eyJ', 'WIFI:', '-----BEGIN PRIVATE KEY-----', 'abandon ',
    'AB12 ', 'a.', 'box admin / ', '"', 'mdp:"', 'login/', 'https://a:', 'otpauth://totp/a?', '4111-', 'pin ', 'é'].map(rep);
  pieges.push('mdp' + ' '.repeat(n - 10) + 'Xk', 'Bearer ' + 'a'.repeat(n - 7), 'x'.repeat(n - 2) + '/y');
  for (const p of pieges) {
    const t0 = performance.now();
    const res = tri.trierSecrets(p);
    const ms = performance.now() - t0;
    assert.ok(ms < 3000, `${JSON.stringify(p.slice(0, 20))}… : ${Math.round(ms)} ms`);
    assert.equal(typeof res.texte, 'string');
  }
  const long = tri.trierSecrets(`mdp : ${mdp()} ${'a'.repeat(tri.LONGUEUR_MAX)}`);
  assert.equal(long.tropLong, true); assert.equal(long.texte, tri.TEXTE_TROP_LONG); assert.deepEqual(long.secrets, []);
});

test('tri : la liste de mots des phrases de récupération est la liste publique exacte ; la fonction est pure', () => {
  assert.equal(tri.LISTE_BIP39.length, 2048);
  assert.equal(createHash('sha256').update(tri.LISTE_BIP39.join('\n') + '\n').digest('hex'), tri.EMPREINTE_LISTE_BIP39);
  const v = mdp(), ctx = { derniersMessages: ['la box'], questionOdin: 'Le mot de passe ?' };
  const avant = JSON.stringify(ctx);
  const a = tri.trierSecrets(`mdp : ${v}`, ctx), b = tri.trierSecrets(`mdp : ${v}`, ctx);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(ctx), avant);
  assert.deepEqual(tri.trierSecrets(''), { texte: '', secrets: [] });
});

test('tri, relecture : écritures courantes (espaces insécables, doubles, retour dans le mot-clé, variables en minuscules, ssh, valeur longue)', () => {
  const v = mdp();
  const cas = [
    `mot de passe :\u00a0${v}`, `mot de passe\u00a0:\u00a0${v}`, `mot  de  passe : ${v}`, `mot de\npasse : ${v}`,
    `db_password=${v}`, `smtp_pass: ${v}`, `mdp : base64 ${Buffer.from(v).toString('base64')}`,
  ];
  for (const p of cas) {
    const res = tri.trierSecrets(p);
    assert.ok(res.secrets.length >= 1, `non reconnu : ${JSON.stringify(p)}`);
    absente(res.texte, p.includes('base64') ? Buffer.from(v).toString('base64') : v);
  }
  let res = tri.trierSecrets(`ssh lea:${v}@192.0.2.10`);
  absente(res.texte, v); assert.ok(!/\blea\b/.test(res.texte), res.texte);
  const long = `${v}${tirer(300)}`;
  res = tri.trierSecrets(`mot de passe : ${long} fin`);
  absente(res.texte, long); assert.match(res.texte, / fin$/);
  // Collée à une lettre ailleurs dans le message : retirée aussi.
  res = tri.trierSecrets(`mdp : ${v} et x${v}`);
  absente(res.texte, v);
});

test('tri, relecture : l\'identifiant qui accompagne un mot de passe est retiré avec lui', () => {
  const v = mdp();
  for (const [p, nom] of [
    [`mon identifiant est admin et mon mot de passe est ${v}`, undefined],
    [`Box : identifiant admin, mot de passe ${v}`, 'Box'],
    [`login admin pass ${v}`, undefined],
    [`login admin pass: ${v}`, undefined],
    [`user: lea pass: ${lettres(9)}`, undefined],
  ] as Array<[string, string | undefined]>) {
    const res = tri.trierSecrets(p);
    const id = res.secrets.find((s) => s.champ === 'identifiant');
    assert.ok(id, `identifiant oublié : ${p} → ${res.texte}`);
    assert.ok(!new RegExp(`\b${id.valeur}\b`).test(res.texte), res.texte);
    if (nom) assert.equal(id.nom, nom);
    assert.ok(res.secrets.some((s) => s.champ === 'mot de passe'), p);
  }
});

test('tri, relecture : des messages normaux ne sont pas avalés (mots-clés ambigus, réponses en mots courants, question qui ne demande rien)', () => {
  for (const p of ['User: Bonjour, peux-tu m’aider ?', 'Login: lundi matin', 'Pass: Navigo mensuel', 'Le secret : beaucoup de patience', 'login admin']) {
    const res = tri.trierSecrets(p);
    assert.deepEqual(res.secrets, [], `pris à tort : ${p}`); assert.equal(res.texte, p);
  }
  for (const [rep, q] of [
    ['merci', 'Quel est le mot de passe de la box ?'], ['demain soir', 'Quel est le mot de passe de la box ?'],
    ['je regarde demain', 'Quel est le mot de passe de la box ?'], ['hier soir', 'Tu as changé le mot de passe de la box ?'],
    [mdp(), 'Tu as changé le mot de passe de la box ?'],
  ]) assert.deepEqual(tri.trierSecrets(rep, { questionOdin: q }).secrets, [], `${rep} après « ${q} »`);
  // Une vraie demande reste prise, en plusieurs langues.
  for (const q of ['Tu peux me donner le mot de passe de la box ?', 'What is the wifi password?', '¿Cuál es la contraseña del router?', 'Nitumie nenosiri la box', 'Le mot de passe de la box ?']) {
    const w = mdp();
    assert.equal(tri.trierSecrets(w, { questionOdin: q }).secrets[0]?.valeur, w, q);
  }
  const w = mdp(), res = tri.trierSecrets(`admin\n${w}`, { questionOdin: 'Identifiant et mot de passe de la box ?' });
  assert.deepEqual(res.secrets.map((s) => [s.champ, s.valeur]), [['identifiant', 'admin'], ['mot de passe', w]]);
});

test('tri, relecture : un message chargé de secrets reste rapide et ne laisse rien passer ; IBAN d\'un pays hors registre refusé', () => {
  for (const [nb, max] of [[8000, 100_000], [16000, 199_000]] as const) {
    const p = Array.from({ length: nb }, (_, i) => `mdp : Ab1#${i.toString(36)}z`).join(' ').slice(0, max);
    const t0 = performance.now();
    const res = tri.trierSecrets(p);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${nb} secrets : ${Math.round(ms)} ms`);
    assert.ok(!res.texte.includes('Ab1#'), 'une valeur est restée');
  }
  const bban = tirer(16, '0123456789');
  const num = (s: string) => [...s].map((c) => (c >= 'A' ? String(c.charCodeAt(0) - 55) : c)).join('');
  let reste = 0; for (const d of num(`${bban}XQ00`)) reste = (reste * 10 + Number(d)) % 97;
  const faux = `XQ${String(98 - reste).padStart(2, '0')}${bban}`;
  assert.ok(tri.ibanValide(faux), 'la clé est juste');
  assert.deepEqual(tri.trierSecrets(`Votre référence : ${faux}`).secrets, []);
});

test('tri, correctif : un mot du mot-clé annoncé (« mot », « mdp », « password »…) n\'est jamais pris pour la valeur', () => {
  // Valeurs d'essai inventées ; le mot de passe a l'air d'un secret, l'identifiant porte un chiffre.
  const v = `Qz8-${'essai'}-vw`, id = 'admin7';
  const reste = (texte: string, x: string) => new RegExp(String.raw`(?<![\p{L}\p{N}])${x}(?![\p{L}\p{N}])`, 'u').test(texte);
  const cas = [
    // Les formes signalées, puis leurs variantes en plusieurs langues.
    `box identifiant ${id} / mot de passe ${v}`, `Box : identifiant ${id}, mot de passe ${v}`, `mdp : ${v}`, `login ${id} mdp ${v}`,
    `wifi : mot de passe ${v}`, `box identifiant : ${id} / mdp : ${v}`, `box identifiant ${id} / mdp ${v}`,
    `router username ${id} / password ${v}`, `Router: username ${id}, password ${v}`, `login ${id} password ${v}`, `wifi: password ${v}`,
    `box login ${id} / password ${v}`, `box login: ${id} / pass: ${v}`, `box user ${id} / pwd ${v}`, `wifi password: password ${v}`,
    `router usuario ${id} / contraseña ${v}`, `router: nombre de usuario ${id}, contraseña ${v}`,
    `Router Benutzername ${id} / Passwort ${v}`, `Router: Benutzername ${id}, Passwort ${v}`,
    `roteador usuário ${id} / senha ${v}`, `roteador: nome de usuário ${id}, senha ${v}`, `router nome utente ${id} / password ${v}`,
    `box jina la mtumiaji ${id} / nenosiri ${v}`, `box اسم المستخدم ${id} / كلمة المرور ${v}`,
    // Les voisins : l'autre ordre, « - », « ; », « , », sur deux lignes, suivi d'un autre secret.
    `mot de passe ${v} / identifiant ${id}`, `box mdp ${v} / login ${id}`, `box identifiant ${id} - mot de passe ${v}`,
    `box identifiant ${id} ; mot de passe ${v}`, `box identifiant ${id}, mdp ${v}`, `box identifiant ${id}\nmot de passe ${v}`,
    `box identifiant : ${id}\nmot de passe : ${v}`, `box identifiant ${id} / mot de passe ${v} / code PIN 4821`,
    // Le mot-clé collé à la barre, en majuscules, coupé par un retour, au pluriel, et la faute « pass word ».
    `box identifiant ${id} / pass ${v}`, `box identifiant ${id} / mdp: ${v}`, `box identifiant ${id} / Mot De Passe ${v}`,
    `box identifiant ${id} / mot  de\npasse ${v}`, `box identifiant ${id} / mots de passe ${v}`, `box identifiant ${id} / pass word ${v}`,
    `box Benutzer ${id} / Kennwort ${v}`, `box usuario ${id} / clave ${v}`, `box nama pengguna ${id} / kata sandi ${v}`,
  ];
  for (const p of cas) {
    const res = tri.trierSecrets(p);
    const pw = res.secrets.filter((s) => s.champ === 'mot de passe' || s.champ === 'clé Wi-Fi');
    assert.deepEqual(pw.map((s) => s.valeur), [v], `${JSON.stringify(p)} → ${JSON.stringify(res.secrets.map((s) => s.valeur))}`);
    absente(res.texte, v);
    if (p.includes(id)) {
      assert.deepEqual(res.secrets.filter((s) => s.champ === 'identifiant').map((s) => s.valeur), [id], JSON.stringify(p));
      assert.ok(!reste(res.texte, id), `identifiant resté : ${res.texte}`);
    }
    if (p.includes('4821')) assert.ok(!res.texte.includes('4821'), res.texte);
    // Aucun mot-clé n'est rangé comme valeur, et le mot-clé reste lisible.
    for (const s of res.secrets) assert.ok(!/^(?:mot|de|passe|mdp|password|pass|pwd|passwort|senha|contraseña|nenosiri|كلمة|login|user|identifiant)$/iu.test(s.valeur), s.valeur);
  }
  // Une valeur qui commence par un mot-clé mais le prolonge reste une valeur.
  for (const w of ['Password!2024', 'pass-word-99']) assert.equal(tri.trierSecrets(`mot de passe : ${w}`).secrets[0]?.valeur, w);
  // Un mot-clé qui n'annonce rien (en fin de texte, avant « / X », avant un autre mot-clé) EST la valeur : « user »,
  // « password » sont de vrais identifiants et mots de passe de box ; rien ne reste en clair.
  const paire = (p: string, q?: string) => tri.trierSecrets(p, q ? { questionOdin: q } : {});
  const champs = (p: string, q?: string) => { const r = paire(p, q); return r.secrets.map((s) => [s.champ, s.valeur]); };
  for (const [p, attendu] of [
    [`identifiant : user / ${v}`, [['identifiant', 'user'], ['mot de passe', v]]],
    [`identifiant : login / ${v}`, [['identifiant', 'login'], ['mot de passe', v]]],
    [`identifiant : pin / ${v}`, [['identifiant', 'pin'], ['mot de passe', v]]],
    [`user/pass : user ${v}`, [['identifiant', 'user'], ['mot de passe', v]]],
    [`login: user / pass: ${v}`, [['identifiant', 'user'], ['mot de passe', v]]],
    [`identifiant user mot de passe ${v}`, [['identifiant', 'user'], ['mot de passe', v]]],
    [`box : user / ${v}`, [['identifiant', 'user'], ['mot de passe', v]]],
    [`box : login / ${v}`, [['identifiant', 'login'], ['mot de passe', v]]],
    ['mot de passe : password', [['mot de passe', 'password']]], ['mot de passe : Password', [['mot de passe', 'Password']]],
    ['mot de passe : secret', [['mot de passe', 'secret']]], ['mdp : pass', [['mot de passe', 'pass']]],
    ['wifi key: password', [['clé Wi-Fi', 'password']]], ['Passwort: passwort', [['mot de passe', 'passwort']]],
  ] as Array<[string, string[][]]>) {
    assert.deepEqual(champs(p), attendu, p);
    for (const [, x] of attendu) assert.ok(!reste(paire(p).texte.replace(/\[[^\]]*\]/g, ''), x), `${x} resté : ${paire(p).texte}`);
  }
  // Les réponses à une question d'Odin : le mot-clé seul, ou la paire, est la réponse.
  const qm = 'Quel est le mot de passe de la box ?', qp = 'Identifiant et mot de passe de la box ?';
  assert.deepEqual(champs('password', qm), [['mot de passe', 'password']]);
  assert.deepEqual(champs('secret', qm), [['mot de passe', 'secret']]);
  assert.deepEqual(champs(`user ${v}`, qp), [['identifiant', 'user'], ['mot de passe', v]]);
  assert.deepEqual(champs('user password', qp), [['identifiant', 'user'], ['mot de passe', 'password']]);
  assert.ok(!paire('login admin', qp).texte.includes('admin'), paire('login admin', qp).texte);
  // Mais un morceau de mot-clé (« mot » de « mot de passe ») n'est jamais une réponse.
  assert.deepEqual(champs('mot de passe', qm), []);
});
