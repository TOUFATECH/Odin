// Le masqueur nourri. Demande du propriétaire (19/11) : un secret, Odin « les supprime les conserves nulle part et le
// mettre directement dans le coffre » ; le texte lu par Odin peut partir vers un agent, « secrets masqués » (IBAN, cartes,
// mots de passe, numéros d'identité masqués).
// Ce que l'essai vérifie : après un redémarrage, le masqueur connaît encore les valeurs du coffre (Thésauros) et les clés
// reçues ; une valeur courte connue n'est masquée qu'entière ; les cartes (clé de Luhn) et les IBAN (calcul modulo 97)
// sont masqués en gardant les 4 derniers caractères ; un nombre qui ne passe pas le calcul reste ; un numéro d'identité
// n'est masqué que s'il est annoncé ; coffre fermé au démarrage : le journal le dit, sans valeur.
//
// Aucun vrai numéro : cartes de test publiques, IBAN fabriqués pour passer le calcul, valeurs tirées au hasard.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Redactor, rangerClesRecues } from '../src/heimdall/redact.ts';
import { rangerSecrets } from '../src/valhalla/modules/brisingamen.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { createOdin, type Odin } from '../src/runtime.ts';

const CLE_ESSAI = randomBytes(32).toString('hex');
const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); });

function nouveau(o: { cle?: boolean } = {}): { ctx: ModCtx; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'odin-masqueur-')), dir = join(home, 'valhalla', 'brisingamen');
  dossiers.push(home);
  mkdirSync(dir, { recursive: true });
  if (o.cle === false) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = CLE_ESSAI;
  const ctx = { home, dir, settings: {}, saveSettings: () => undefined, now: () => new Date('2026-11-19T18:00:00Z') } as unknown as ModCtx;
  return { ctx, home };
}

/** Un démarrage d'Odin (sans modèle) ; rend Odin et ce qu'il a écrit au journal pendant le démarrage. */
function demarrer(home: string): { odin: Odin; journal: string[] } {
  const journal: string[] = [];
  const vrai = console.error;
  console.error = (...a: unknown[]) => { journal.push(a.map(String).join(' ')); };
  try {
    const odin = createOdin({ home, provider: new MockProvider([]), configOverride: (c) => ({ ...c, watch: { ...c.watch, enabled: false }, continuous: { ...c.continuous, enabled: false, autoResume: false }, update: { auto: 'off' as const, everyHours: 6 } }) });
    return { odin, journal };
  } finally { console.error = vrai; }
}

function fichiers(d: string): string[] {
  if (!d || !existsSync(d)) return [];
  const out: string[] = [];
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) out.push(...fichiers(p)); else out.push(p); }
  return out;
}
/** Les fichiers du dossier d'essai qui contiennent une des valeurs en clair (UTF-8 ou UTF-16). */
function traces(home: string, valeurs: string[]): string[] {
  return fichiers(home).filter((f) => {
    const b = readFileSync(f);
    return valeurs.some((v) => b.includes(Buffer.from(v, 'utf8')) || b.includes(Buffer.from(v, 'utf16le')));
  });
}

/** Un IBAN fabriqué : la clé (2 chiffres) calculée pour passer le modulo 97. */
function iban(pays: string, bban: string): string {
  const n = BigInt((bban + pays + '00').toUpperCase().replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55)));
  return `${pays}${String(98n - (n % 97n)).padStart(2, '0')}${bban}`;
}
const parQuatre = (s: string) => s.replace(/(.{4})(?=.)/g, '$1 ');

test('une carte qui passe la clé de Luhn est masquée en gardant ses 4 derniers chiffres', () => {
  const r = new Redactor();
  const sortie = r.redact('Paiement refusé pour la carte 4111 1111 1111 1111 hier ; puis 5555555555554444 accepté.');
  assert.ok(!sortie.includes('4111 1111 1111 1111') && !sortie.includes('5555555555554444'), sortie);
  assert.ok(sortie.includes('carte ••••1111') && sortie.includes('carte ••••4444'), sortie);
});

test('un nombre de 16 chiffres qui ne passe pas la clé de Luhn reste, à côté d\'une carte vérifiée masquée', () => {
  const r = new Redactor();
  const sortie = r.redact('Lot 4111 1111 1111 1112 reçu ; carte 4111 1111 1111 1111.');
  assert.ok(sortie.includes('4111 1111 1111 1112'), `le nombre non vérifié reste : ${sortie}`);
  assert.ok(!sortie.includes('4111 1111 1111 1111'), `la carte vérifiée est masquée : ${sortie}`);
});

test('un IBAN qui passe le calcul modulo 97 est masqué en gardant ses 4 derniers caractères ; un faux reste', () => {
  const fr = iban('FR', '99999000010123456789042'), de = iban('DE', '999999990012345678');
  const faux = fr.slice(0, 2) + String((Number(fr.slice(2, 4)) + 1) % 100).padStart(2, '0') + fr.slice(4);
  const r = new Redactor();
  const sortie = r.redact(`Virement vers ${parQuatre(fr)} et ${de}. Ancien : ${parQuatre(faux)}`);
  assert.ok(!sortie.includes(parQuatre(fr)) && !sortie.includes(de), sortie);
  assert.ok(sortie.includes(`IBAN ••••${fr.slice(-4)}`) && sortie.includes(`IBAN ••••${de.slice(-4)}`), sortie);
  assert.ok(sortie.includes(parQuatre(faux)), `un IBAN dont la clé est fausse reste : ${sortie}`);
});

test('les formes sûres du tri : phrase de récupération et mot de passe dans une adresse', () => {
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const mdp = `Nq7-${randomBytes(6).toString('hex')}`;
  const r = new Redactor();
  const sortie = r.redact(`Sauvegarde : ${phrase}\nmontage https://lina:${mdp}@nas.exemple.org/partage`);
  assert.ok(!sortie.includes(phrase) && !sortie.includes(mdp), sortie);
  assert.ok(sortie.includes('https://lina:'), `l'identifiant n'est pas un secret : il reste lisible : ${sortie}`);
});

test('un numéro d\'identité n\'est masqué que s\'il est annoncé', () => {
  const r = new Redactor();
  const annonces = [
    'Mon numéro de passeport : 12AB34567',
    'passport number is 12AB34567',
    'DNI: 12345678Z',
    'SSN 900-12-3456',
    'N° de sécurité sociale : 2 99 13 99 999 999 99',
    'Reisepassnummer: C01X00T47',
  ];
  for (const a of annonces) {
    const s = r.redact(a);
    assert.ok(s.includes('[SECRET]') && !/\d{4}/.test(s.replace(/\[SECRET\]/g, '')), `${a} → ${s}`);
  }
  const ordinaires = ['Commande 12AB34567 expédiée', 'Mon passeport expire le 12.03.2027', 'passport photos: 2 copies', 'numéro de passeport : à renouveler', 'Passeport : 12.03.2027'];
  for (const o of ordinaires) assert.equal(r.redact(o), o);
});

test('après un redémarrage : les valeurs du coffre (et l\'ancienne) et les clés reçues sont masquées ; rien n\'est écrit en clair', () => {
  const { ctx, home } = nouveau();
  const ancien = `Vx8-${randomBytes(9).toString('base64url')}`, mdp = `Qz4-${randomBytes(9).toString('base64url')}`;
  const pin = `${randomBytes(2).readUInt16BE() % 9000 + 1000}`;
  const compte = { role: 'owner' as const, id: 'proprio', nom: 'Nour' };
  assert.equal(rangerSecrets(ctx, compte, [{ nom: 'Box', champ: 'mot de passe', valeur: ancien }]).ok, true);
  assert.equal(rangerSecrets(ctx, compte, [{ nom: 'Box', champ: 'mot de passe', valeur: mdp }, { nom: 'Box', champ: 'code PIN', valeur: pin }]).ok, true);
  const jeton = `${700000000 + (randomBytes(3).readUIntBE(0, 3) % 99999999)}:${randomBytes(27).toString('base64url').slice(0, 35)}`;
  assert.equal(rangerClesRecues(home, [jeton]).length, 1);
  // Rangée au coffre : son fichier chiffré, jamais le fichier en clair.
  assert.ok(existsSync(join(home, 'secrets-cles-recues.json.enc')) && !existsSync(join(home, 'secrets-cles-recues.json')), 'clé reçue rangée chiffrée');
  assert.deepEqual(traces(home, [jeton]), [], 'clé reçue en clair sur le disque dès le rangement');

  const { odin, journal } = demarrer(home);
  try {
    const sortie = odin.redactor.redact(`Box : ${mdp} (avant : ${ancien}), PIN ${pin}.\nGET https://api.telegram.org/bot${jeton}/getMe`);
    for (const v of [mdp, ancien, jeton]) assert.ok(!sortie.includes(v), `${v.slice(0, 3)}… encore là : ${sortie}`);
    assert.ok(!new RegExp(`(?<!\\d)${pin}(?!\\d)`).test(sortie), `le code PIN (court) encore là : ${sortie}`);
    assert.ok(journal.every((l) => ![mdp, ancien, jeton, pin].some((v) => l.includes(v))), 'aucune valeur au journal');
  } finally { odin.close(); }
  assert.deepEqual(traces(home, [mdp, ancien]), [], 'aucune valeur du coffre en clair sur le disque');
  // Le démarrage ne recopie la clé reçue nulle part en clair.
  const apres = traces(home, [jeton]);
  assert.deepEqual(apres, [], `clé reçue en clair après le démarrage : ${apres.map((f) => f.slice(home.length + 1)).join(', ')}`);
});

test('une valeur courte connue n\'est masquée qu\'entière ; un mot qui la contient n\'est pas avalé', () => {
  const { ctx, home } = nouveau();
  assert.equal(rangerSecrets(ctx, { role: 'owner', id: 'proprio', nom: 'Nour' }, [{ nom: 'Wi-Fi', champ: 'clé Wi-Fi', valeur: 'soleil' }, { nom: 'Cadenas', champ: 'code', valeur: 'K7m2' }]).ok, true);
  const { odin } = demarrer(home);
  try {
    const sortie = odin.redactor.redact('Le Wi-Fi : soleil. Les parasoleils et soleils restent ; cadenas K7m2, pas K7m2x ni xK7m2.');
    assert.equal(sortie, 'Le Wi-Fi : [SECRET]. Les parasoleils et soleils restent ; cadenas [SECRET], pas K7m2x ni xK7m2.');
  } finally { odin.close(); }
});

test('coffre fermé au démarrage : le masqueur garde ce qu\'il connaît sans coffre et le dit au journal, sans valeur', () => {
  const { ctx, home } = nouveau();
  const mdp = `Hk3-${randomBytes(9).toString('base64url')}`;
  assert.equal(rangerSecrets(ctx, { role: 'owner', id: 'proprio', nom: 'Nour' }, [{ nom: 'Box', champ: 'mot de passe', valeur: mdp }]).ok, true);
  delete process.env.BRISINGAMEN_KEY;
  const env = `Jt5-${randomBytes(9).toString('base64url')}`;
  process.env.ESSAI_MASQUEUR_TOKEN = env;
  try {
    const { odin, journal } = demarrer(home);
    try {
      const ligne = journal.find((l) => l.startsWith('[masqueur]'));
      assert.ok(ligne && /coffre/i.test(ligne) && /ferm/i.test(ligne), `le journal le dit : ${journal.join(' | ')}`);
      assert.ok(!ligne.includes(mdp) && !ligne.includes(CLE_ESSAI));
      assert.ok(!odin.redactor.redact(`jeton ${env}`).includes(env), 'les valeurs connues sans coffre restent masquées');
    } finally { odin.close(); }
  } finally { delete process.env.ESSAI_MASQUEUR_TOKEN; }
});

test('le coffre d\'un membre ne sert pas à masquer le texte des autres : seul celui du propriétaire est chargé', () => {
  const { ctx, home } = nouveau();
  const sien = `Pm2-${randomBytes(9).toString('base64url')}`, proprio = `Po6-${randomBytes(9).toString('base64url')}`;
  assert.equal(rangerSecrets(ctx, { role: 'member', id: 'm-ilyas', nom: 'Ilyas' }, [{ nom: 'Console', champ: 'mot de passe', valeur: sien }]).ok, true);
  assert.equal(rangerSecrets(ctx, { role: 'owner', id: 'proprio', nom: 'Nour' }, [{ nom: 'Box', champ: 'mot de passe', valeur: proprio }]).ok, true);
  const { odin } = demarrer(home);
  try {
    const sortie = odin.redactor.redact(`${sien} ${proprio}`);
    assert.ok(sortie.includes(sien), 'la valeur du membre n\'est pas dans le masqueur commun');
    assert.ok(!sortie.includes(proprio), 'celle du propriétaire, oui');
  } finally { odin.close(); }
});

test('sans rien de connu, un texte ordinaire reste tel quel', () => {
  const t = 'Le 19/11 à 14 h 32, commande 4521 livrée au 12 rue des Lilas ; code postal 97600 ; 3 000 € versés.';
  assert.equal(new Redactor().redact(t), t);
});

// Les cas ci-dessous viennent de la relecture : une forme sûre courte ne doit pas avaler les mots ordinaires du texte, et
// un texte coupé pour le tri ne doit laisser passer aucune carte.

test('une valeur courte d\'une variable (« sort_key: name ») n\'est masquée que là, pas partout où le mot revient', () => {
  const r = new Redactor();
  assert.equal(r.redact('sort_key: name\nThe name field is required; rename the name.'), 'sort_key: [SECRET]\nThe name field is required; rename the name.');
  assert.equal(r.redact('cache_key=true\nenabled=true\nverbose: true'), 'cache_key=[SECRET]\nenabled=true\nverbose: true');
  assert.equal(r.redact('{"token": "none", "user": "lina", "next": "none"}'), '{"token": "[SECRET]", "user": "lina", "next": "none"}');
  assert.equal(r.redact('foreign_key: user\nThe user logged in.'), 'foreign_key: [SECRET]\nThe user logged in.');
  // Le même mot de passe court rangé deux fois sous un nom de secret : masqué aux deux endroits.
  assert.equal(r.redact('db_password=Kq7z\nbackup_password: Kq7z\nKq7z ailleurs'), 'db_password=[SECRET]\nbackup_password: [SECRET]\nKq7z ailleurs');
  // Un mot de passe court dans une adresse : masqué là, pas dans le reste du texte.
  const s = r.redact('montage https://lina:x9@nas.exemple.org/partage ; voir la section x9 du guide');
  assert.ok(s.includes('https://lina:[SECRET]@nas.exemple.org') && s.includes('section x9 du guide'), s);
  // Une valeur longue (8 caractères ou plus) reste masquée partout.
  const long = `Wr5-${randomBytes(6).toString('hex')}`;
  assert.equal(r.redact(`smtp_pass=${long}\nrappel : ${long}`), 'smtp_pass=[SECRET]\nrappel : [SECRET]');
});

test('beaucoup de secrets dans un texte court (plus que le tri n\'en prend) : la carte est quand même masquée', () => {
  let t = '';
  for (let i = 0; i < 270; i++) t += `pin: ${1000 + i}\n`;
  t += 'carte 4111 1111 1111 1111\n';
  for (let i = 0; i < 270; i++) t += `a_key=v${i}xx\n`;
  t += 'et 5555555555554444 fin';
  const s = new Redactor().redact(t);
  assert.ok(!s.includes('4111 1111 1111 1111') && !s.includes('5555555555554444'), 'aucune carte en clair');
  assert.ok(s.includes('carte ••••1111') && s.includes('carte ••••4444'));
});

test('une ligne sans retour plus longue que la limite du tri : une carte à cheval sur la coupe est masquée', () => {
  const carte = '4111111111111111';
  for (const n of [300_000, 400_001]) {
    const milieu = n >> 1, avant = 'a '.repeat(Math.floor((milieu - 8) / 2)) + (milieu % 2 ? 'a' : '');
    const t = avant + carte + ' b'.repeat(Math.ceil((n - avant.length - carte.length) / 2));
    assert.ok(t.indexOf(carte) < milieu && t.indexOf(carte) + carte.length > milieu, 'la carte est bien à cheval');
    const s = new Redactor().redact(t);
    assert.ok(!s.includes(carte) && s.includes('carte ••••1111'), `longueur ${t.length} : carte en clair`);
  }
});

test('une clé privée à cheval sur une coupe du tri (texte long, ou plein de secrets) est masquée en entier', () => {
  const corps = Array.from({ length: 40 }, () => randomBytes(48).toString('base64'));
  const cle = `-----BEGIN PRIVATE KEY-----\n${corps.join('\n')}\n-----END PRIVATE KEY-----`;
  const lignes = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_v, i) => f(i)).join('\n');
  const cas = [
    lignes(6000, (i) => `ligne ${i} : rien de particulier ici`),
    lignes(300, (i) => `pin: ${1000 + i}`),
  ];
  for (const autour of cas) {
    const s = new Redactor().redact(`${autour}\n${cle}\n${autour}`);
    const restes = corps.filter((l) => s.includes(l));
    assert.equal(restes.length, 0, `${restes.length} lignes de la clé en clair (texte de ${autour.length * 2} car.)`);
  }
});
