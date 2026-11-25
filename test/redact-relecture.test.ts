// Le masquage des secrets (src/heimdall/redact.ts) après la correction du temps de calcul : il reconnaît EXACTEMENT ce
// que reconnaissaient les expressions d'origine. Elles sont gardées ici comme témoin (elles ne servent plus ailleurs),
// et chaque texte fabriqué est donné aux deux : le témoin et le masquage d'aujourd'hui doivent rendre le même texte.
//  - les phrases « mot de passe … est … » : mot × blancs avant × verbe ou signe × blancs après × guillemet × valeur ;
//  - toutes les suites courtes de quelques morceaux (plusieurs annonces collées dans une même suite sans espace) ;
//  - les clés « sk- » (un chiffre et une majuscule exigés) ; les liens de connexion dans un courriel lu.
// Les témoins sont lents sur un texte long (c'est le défaut corrigé) : ici les textes sont courts. Valeurs d'exemple.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Redactor, extraireCles, masquerCodes } from '../src/heimdall/redact.ts';

// Les blancs qui ne se voient pas sont fabriqués par leur numéro (jamais écrits tels quels dans ce fichier).
const INSECABLE = String.fromCharCode(0xa0), IDEOGRAPHIQUE = String.fromCharCode(0x3000), SEPARATEUR_DE_LIGNE = String.fromCharCode(0x2028);
// Un signe qui n'est pas une lettre, mais qui compte pour une quand la casse est ignorée (le seul d'Unicode) : l'expression
// d'origine le prenait pour une lettre, le masquage d'aujourd'hui doit le faire aussi.
const YPOGEGRAMMENI = String.fromCharCode(0x345);

// ---------------------------------------------------------------------------------------------------------------
// Les expressions d'ORIGINE (telles qu'avant la correction). Ne jamais les lancer sur un texte long.
const MOTS_DE_PASSE = [
  'mots? de passe', 'mdp', 'pass(?:word|wd|code|phrase)s?', 'pwd', 'contrase(?:ñ|n)as?', 'claves?', 'passw(?:ö|o)rt(?:er)?', 'kennw(?:ö|o)rt',
  'senhas?', 'wachtwoord(?:en)?', "parola d'ordine", 'password', 'has(?:ł|l)o', 'парол(?:ь|я)', 'şifre', 'kata sandi', 'nenosiri',
  '密码', '密碼', 'パスワード', '비밀번호', 'كلمة (?:ال)?(?:مرور|سر)',
].join('|');
const VERBES = '\\s(?:est|is|es|ist|é|è|era|was|lautet|wordt|jest|это|هي)(?![\\p{L}])|\\s*[:=：—]|是|は|는';
const VALEUR = '[^\\s"\'«»“”,;]';
const LETTRE = '[\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}\\p{Script=Arabic}\\p{N}_]';
const TEMOIN_PHRASE = new RegExp(
  `(?<=(?<!${LETTRE})(?:${MOTS_DE_PASSE})(?!${LETTRE})[^\\n.;!?]{0,40}?(?:${VERBES})\\s*["'«“]?\\s*)(?=${VALEUR}*\\p{L})(?=${VALEUR}*(?:\\p{N}|[\\p{S}@#%&*_!?]${VALEUR}))${VALEUR}{3,}`, 'giu');
const TEMOIN_VARIABLE = /(?<=\b(?:password|passwd|secret|api[_-]?key|token)\s*[=:]\s*["']?)[^\s"']{6,}/gi;
const TEMOIN_CLE_SK = /(?<![A-Za-z0-9])sk-(?:proj-|or-v1-)?(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{20,}/g;
const TEMOIN_LIEN = /https?:\/\/\S*(reset|r[ée]initiali|password|passwd|mot-de-passe|verify|v[ée]rif|magic|token|otp|login|signin|confirm)\S*/gi;
/** Ce que le masquage d'origine rendait pour un texte sans autre secret : la règle des variables, puis la phrase. */
const temoin = (s: string): string => s.replace(TEMOIN_VARIABLE, '[SECRET]').replace(TEMOIN_PHRASE, '[SECRET]');

/** Toutes les suites de 1 à `max` morceaux pris dans `morceaux`. */
function* suites(morceaux: string[], max: number): Generator<string> {
  const idx = new Array<number>(max).fill(0);
  for (let n = 1; n <= max; n++) {
    idx.fill(0);
    for (;;) {
      let s = '';
      for (let i = 0; i < n; i++) s += morceaux[idx[i]];
      yield s;
      let i = 0;
      while (i < n && ++idx[i] === morceaux.length) idx[i++] = 0;
      if (i === n) break;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
test('phrases « mot de passe … est … » : mot × blancs × verbe × blancs × guillemet × valeur, même texte masqué que le témoin', () => {
  const MOTS = ['mot de passe', 'mdp', 'Password', 'passwd', 'pwd', 'passphrase', 'contraseña', 'clave', 'passwort', 'kennwort', 'senha', 'wachtwoord', "parola d'ordine", 'hasło',
    'пароль', 'şifre', 'kata sandi', 'nenosiri', '密码', '密碼', 'パスワード', '비밀번호', 'كلمة السر', 'كلمة المرور', 'mot de pass', 'xmdp', 'mdpx'];
  const DEBUTS = ['', 'le ', 'voici.\n', '« '];
  const MILIEUX = ['', ' du wifi', ' de la box de la maison du voisin d en face', ' de la box de la maison du voisin d en fac', ' ok. et'];
  const BLANCS_AVANT = ['', ' ', '\n', '\t', INSECABLE, ' \n '];
  // plus longs que les « 0 à 40 caractères » permis entre le mot et le verbe (un cas sur trente et un : le témoin y est lent)
  const BLANCS_LONGS = [' '.repeat(41), `${' '.repeat(20)}\n${' '.repeat(25)}`];
  const VERBES_DITS = [' est', ' is', ' es', ' ist', ' é', ' lautet', ' jest', ' это', ' هي', 'est', ':', '=', '：', '—', '是', 'は', '는', '::', ' sera', ''];
  const BLANCS_APRES = ['', ' ', '\n', INSECABLE, '    \n', ` ${IDEOGRAPHIQUE}${SEPARATEUR_DE_LIGNE}`];
  const GUILLEMETS = ['', '"', "'", '«', '“', '" ', `'${INSECABLE}   \n`, '»', '""'];
  const VALEURS = ['Zebre-Orange-42', 'a1', 'ab', 'a1b', 'abc', '123', 'a!b', 'ab!', '!ab', ',a1b', 'a1b"', 'trop court', '24/11/2026', '密a1', `12${YPOGEGRAMMENI}`, 'mdp:b2c'];
  const r = new Redactor();
  let k = 0, masquees = 0;
  for (const ba of BLANCS_AVANT) for (const v of VERBES_DITS) for (const bp of BLANCS_APRES) for (const g of GUILLEMETS) for (const val of VALEURS) {
    k++;
    // le mot, le début et le milieu tournent : chaque mot passe par chaque verbe et chaque valeur
    const s = `${DEBUTS[(k >> 3) % DEBUTS.length]}${MOTS[(k + (k >> 5)) % MOTS.length]}${MILIEUX[(k >> 1) % MILIEUX.length]}${k % 31 ? ba : BLANCS_LONGS[(k >> 5) % 2]}${v}${bp}${g}${val}${k % 3 ? '' : ' voilà.'}`;
    const attendu = temoin(s);
    if (attendu !== s) masquees++;
    assert.equal(r.redact(s), attendu, JSON.stringify(s));
  }
  assert.equal(k, 6 * 20 * 6 * 9 * 16);
  assert.ok(masquees > 10_000, `le jeu doit porter beaucoup de phrases masquées (${masquees})`);
});

test('toutes les suites courtes de morceaux (annonces collées, blancs, guillemets) : même texte masqué que le témoin', () => {
  const r = new Redactor();
  let cas = 0, masquees = 0;
  for (const [i, morceaux] of [
    ['mdp', ' ', '\n', INSECABLE, ':', ' est', '"', 'a', '1', 'a1b'],
    ['密码', 'パスワード', '是', 'は', '：', IDEOGRAPHIQUE, '“', 'a', '1', 'a1字'],
    ['token', 'password', ' ', '\n', '=', ':', '"', "'", 'abcde', 'abcdef'],
  ].entries()) for (const s of suites(morceaux, i ? 4 : 5)) {
    cas++;
    const attendu = temoin(s);
    if (attendu !== s) masquees++;
    assert.equal(r.redact(s), attendu, JSON.stringify(s));
  }
  assert.equal(cas, 111_110 + 2 * 11_110);
  assert.ok(masquees > 1_000, `beaucoup de suites masquées (${masquees})`);
});

test('clés « sk- » : la même clé retirée que le témoin (un chiffre et une majuscule exigés), nulle part ailleurs', () => {
  let cas = 0, cles = 0;
  for (const s of suites(['sk-', 'proj-', 'or-v1-', 'a', 'A', '1', '-', '_', ' ', 'abcdefghij', 'ABCDEFGHIJ', '0123456789'], 5)) {
    cas++;
    const attendues: string[] = [];
    const attendu = s.replace(TEMOIN_CLE_SK, (m) => { attendues.push(m); return '[clé mise au coffre]'; });
    cles += attendues.length;
    assert.deepEqual(extraireCles(s), { text: attendu, cles: attendues }, JSON.stringify(s));
  }
  assert.ok(cas > 250_000 && cles > 3_000, `${cas} suites, ${cles} clés`);
});

test('liens de connexion d\'un courriel lu : le même lien masqué que le témoin, ligne par ligne', () => {
  let cas = 0, masques = 0;
  for (const s of suites(['http://', 'https://', 'HTTP://', 'a', ' ', 'reset', 'otp', 'LOGIN', '/', 'rÉinitiali', 'htt', 'p', ':', 's', '\n'], 4)) {
    cas++;
    const attendu = s.split('\n').map((l) => l.replace(TEMOIN_LIEN, '[lien de connexion ou de réinitialisation — masqué]')).join('\n');
    if (attendu !== s) masques++;
    assert.equal(masquerCodes(s), attendu, JSON.stringify(s));
  }
  assert.ok(cas > 50_000 && masques > 5_000, `${cas} suites, ${masques} avec un lien masqué`);
});
