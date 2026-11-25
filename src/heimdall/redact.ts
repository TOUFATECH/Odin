import { join } from 'node:path';
import { readSecretFile, writeSecretFile } from '../vault.ts';
import { LONGUEUR_MAX, trierSecrets } from './secrets-entrants.ts';
// Heimdall — masquage des secrets.
// Appliqué aux sorties d'outils AVANT qu'elles n'atteignent le modèle, aux journaux
// et aux messages sortants : un secret lu par erreur ne peut ni fuiter ni être mémorisé.

// Un mot de passe DIT en phrase (« le mot de passe du wifi est Zebre-Orange-42 », « the wifi password is … », « la
// contraseña es … ») : le mot qui suit « est / is / es / ist / é / : … ». Seulement une valeur qui a l'air d'un secret
// (au moins une lettre, et un chiffre ou un signe qui n'est ni un trait d'union ni la ponctuation finale ; une date seule n'en est pas un) : « le mot de passe est trop court » reste lisible. Un mot de passe fait de lettres seules
// n'est pas reconnu ici (limite assumée).
const MOTS_DE_PASSE = [
  'mots? de passe', 'mdp', 'pass(?:word|wd|code|phrase)s?', 'pwd', 'contrase(?:ñ|n)as?', 'claves?', 'passw(?:ö|o)rt(?:er)?', 'kennw(?:ö|o)rt',
  'senhas?', 'wachtwoord(?:en)?', "parola d'ordine", 'password', 'has(?:ł|l)o', 'парол(?:ь|я)', 'şifre', 'kata sandi', 'nenosiri',
  '密码', '密碼', 'パスワード', '비밀번호', 'كلمة (?:ال)?(?:مرور|سر)',
].join('|');
// Les verbes écrits en mots demandent une espace avant et pas de lettre après ; les signes, rien.
const VERBES = '\\s(?:est|is|es|ist|é|è|era|was|lautet|wordt|jest|это|هي)(?![\\p{L}])|(?<!\\s)\\s*[:=：—]|是|は|는';
const VALEUR = '[^\\s"\'«»“”,;]'; // (« ! » et « . » peuvent être dans un mot de passe)
// La garde « pas une lettre autour » ne vaut que pour les écritures à espaces (pas pour le chinois, le japonais…) ;
// « _ » compte comme une lettre (MQTT_PASSWORD=… est une variable, laissée à la règle des variables).
const LETTRE = '[\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}\\p{Script=Arabic}\\p{N}_]';
// Temps de calcul (test/redact-temps.test.ts, test/redact-relecture.test.ts) : « trois caractères de valeur devant » est
// regardé d'abord (rien n'est cherché en arrière au milieu d'une suite de blancs), et une suite de blancs n'a qu'une
// seule lecture possible (« (?<!\s)\s* » avant le signe, « \s*(?:"\s*)? » après le verbe). Sans cela, une longue suite de
// blancs coûte le cube de sa longueur. L'expression prend la suite ENTIÈRE qui suit l'annonce (« trop court » aussi) ;
// « a l'air d'un secret » (une lettre, et un chiffre ou un signe) est vérifié ensuite sur la suite trouvée, une seule
// fois (GARDES, plus bas) : regardé en avant à chaque départ, « mdp:::: » répété coûtait le carré de la longueur.
// Ce qui est masqué ne change pas. Ne jamais remplacer avec cette expression sans passer par `estSecret`.
export const PHRASE_MOT_DE_PASSE = new RegExp(
  `(?=${VALEUR}{3})(?<=(?<!${LETTRE})(?:${MOTS_DE_PASSE})(?!${LETTRE})[^\\n.;!?]{0,40}?(?:${VERBES})\\s*(?:["'«“]\\s*)?)${VALEUR}{3,}`, 'giu');
// (les mêmes drapeaux que l'expression : sans « i », un signe qui compte pour une lettre quand la casse est ignorée serait perdu)
const UNE_LETTRE = /\p{L}/iu, CHIFFRE_OU_SIGNE = new RegExp(`\\p{N}|[\\p{S}@#%&*_!?]${VALEUR}`, 'iu');
// OpenAI / OpenRouter : pas au milieu d'un mot (« desk-booking-… ») ; une vraie clé a des chiffres et des majuscules (GARDES).
const CLE_SK = /(?<![A-Za-z0-9])sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}/g;

const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,                 // Anthropic
  CLE_SK,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,                // GitHub
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /AKIA[0-9A-Z]{16}/g,                          // AWS
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,              // Slack
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,            // Telegram bot
  /AIza[0-9A-Za-z_-]{35}/g,                     // Google
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(?=[^\s"']{6})(?<=\b(?:password|passwd|secret|api[_-]?key|token)\s*[=:]\s*["']?)[^\s"']{6,}/gi,
  /(?<=Bearer\s)[A-Za-z0-9._~+/=-]{20,}/g,
  PHRASE_MOT_DE_PASSE,
];
// Ce qu'une suite trouvée doit avoir en plus pour être un secret. Vérifié sur la suite entière, lue une seule fois :
// une suite refusée est passée d'un bloc (aucun départ plus loin dans la même suite ne pourrait être accepté).
const GARDES = new Map<RegExp, (m: string) => boolean>([
  [CLE_SK, (m) => /\d/.test(m) && /[A-Z]/.test(m)],
  [PHRASE_MOT_DE_PASSE, (m) => UNE_LETTRE.test(m) && CHIFFRE_OU_SIGNE.test(m)],
]);
const estSecret = (re: RegExp, m: string): boolean => GARDES.get(re)?.(m) ?? true;

// Une valeur connue exactement mais courte (4 à 7 caractères, une valeur du coffre) n'est masquée qu'entière : pas de
// lettre ni de chiffre collé à elle (dans les écritures à espaces), pour ne pas avaler un mot qui la contient.
const COURTE_MIN = 4;
const AUTOUR = new RegExp(LETTRE, 'u');

/** Les plages à masquer : chaque apparition de `v` (seulement entière si `entiere`, seulement là où `garde` le dit) remplacée par `par`. */
interface Plage { debut: number; fin: number; par: string }
function apparitions(t: string, v: string, par: string, entiere: boolean, out: Plage[], garde?: (i: number) => boolean): void {
  const d = entiere && AUTOUR.test(v[0]), f = entiere && AUTOUR.test(v.at(-1)!);
  for (let i = t.indexOf(v); i >= 0; i = t.indexOf(v, i + 1)) {
    if ((d && AUTOUR.test(t[i - 1] ?? '')) || (f && AUTOUR.test(t[i + v.length] ?? ''))) continue;
    if (garde && !garde(i)) continue;
    out.push({ debut: i, fin: i + v.length, par });
  }
}

// Une forme sûre courte (moins de 8 caractères : « sort_key: name », « "token": "none" », « https://moi:x9@hôte ») n'est
// masquée que là où elle est rangée sous un nom de secret (« …key = », « "token": », « ://identifiant: ») : ailleurs, le
// même mot (« name », « true », « none ») est un mot ordinaire du texte. Les cartes, IBAN, phrases de récupération et
// clés Wi-Fi sont masqués partout (vérifiés par leur calcul, ou trop rares pour être un mot ordinaire).
const PARTOUT = new Set(['carte bancaire', 'IBAN', 'phrase de récupération', 'clé Wi-Fi']);
const CLE_PRIVEE = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----|$)/g;
const SOUS_UN_NOM =/(?:(?:key|token|secret|password|passwd|pwd|pass)["']?[ \t]{0,8}[=:][ \t]{0,8}["']?|:\/\/[^\s:/@]{1,128}:)$/i;

/** Deux morceaux coupés pour le tri se chevauchent d'autant (une forme à cheval sur la coupe est entière dans l'un) ; coupés
 *  à un retour à la ligne, moins : seule une phrase de récupération écrite sur plusieurs lignes peut passer la coupe. */
const CHEVAUCHEMENT = 4096, CHEVAUCHEMENT_LIGNE = 512;
/**
 * Les formes sûres du tri (src/heimdall/secrets-entrants.ts, niveau 1 : clés et jetons, cartes vérifiées par la clé de
 * Luhn, IBAN vérifiés par le calcul modulo 97, phrases de récupération, Wi-Fi en QR, secrets 2FA…), sans les secrets
 * annoncés ni les « probables ». L'identifiant d'une adresse (« https://moi:…@hôte ») n'est pas un secret : il reste.
 * Un texte que le tri ne prend pas (trop long, ou trop de secrets) est coupé en deux morceaux qui se chevauchent, de
 * préférence à un retour à la ligne près du milieu, et ainsi de suite : chaque morceau est plus court que le texte
 * (au plus les trois quarts), un morceau de 256 caractères ou moins est toujours trié. Rend valeur → champ.
 */
function formesSuresDuTri(t: string, out = new Map<string, string>()): Map<string, string> {
  if (!t) return out;
  if (t.length <= LONGUEUR_MAX) {
    const r = trierSecrets(t);
    if (!r.tropLong) {
      for (const s of r.secrets) if (s.niveau === 1 && s.champ !== 'identifiant' && !out.has(s.valeur)) out.set(s.valeur, s.champ);
      return out;
    }
  }
  const n = t.length, milieu = n >> 1;
  let coupe = t.lastIndexOf('\n', milieu) + 1;
  if (coupe < Math.ceil((n * 3) / 8)) {
    const apres = t.indexOf('\n', milieu);
    coupe = apres >= 0 && apres < Math.floor((n * 5) / 8) ? apres + 1 : milieu;
  }
  const marge = Math.min(t[coupe - 1] === '\n' ? CHEVAUCHEMENT_LIGNE : CHEVAUCHEMENT, n >> 3);
  formesSuresDuTri(t.slice(0, Math.min(n, coupe + marge)), out);
  formesSuresDuTri(t.slice(Math.max(0, coupe - marge)), out);
  return out;
}
/** Ce qui remplace une forme sûre : une carte et un IBAN gardent leurs 4 derniers caractères. */
function remplacement(champ: string, valeur: string): string {
  if (champ === 'carte bancaire') return `carte ••••${valeur.replace(/\D/g, '').slice(-4)}`;
  if (champ === 'IBAN') return `IBAN ••••${valeur.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase()}`;
  return '[SECRET]';
}

export class Redactor {
  private exact: string[];
  /** Les valeurs du coffre de 4 à 7 caractères : masquées seulement entières. En mémoire vive seulement. */
  private courtes: string[] = [];

  /** `knownSecrets` : valeurs réelles (variables d'environnement) à masquer à coup sûr. */
  constructor(knownSecrets: string[] = []) {
    this.exact = knownSecrets.filter((s) => s && s.length >= 8);
  }

  /** Ajoute un secret saisi en cours de route (ex. clé enregistrée depuis l'interface web). */
  add(secret: string): void {
    if (secret && secret.length >= 8 && !this.exact.includes(secret)) this.exact.push(secret);
  }

  /**
   * Ajoute une valeur connue exactement parce qu'elle est au coffre : 8 caractères ou plus, masquée partout (comme
   * `add`) ; de 4 à 7, masquée seulement quand elle est entière (séparée de tout mot) ; plus courte, ignorée.
   */
  addCoffre(valeur: string): void {
    if (typeof valeur !== 'string') return;
    if (valeur.length >= 8) this.add(valeur);
    else if (valeur.length >= COURTE_MIN && valeur.trim() === valeur && !this.courtes.includes(valeur)) this.courtes.push(valeur);
  }

  redact(text: string): string {
    // Sur le texte d'origine : les formes sûres du tri, les valeurs connues (longues : partout ; courtes : entières).
    // Un chevauchement : la plus longue l'emporte.
    const plages: Plage[] = [];
    // Une clé privée, d'un bout à l'autre (ou jusqu'à la fin du texte), cherchée sur le texte entier : un texte coupé pour
    // le tri n'en laisse aucun morceau.
    for (const m of text.matchAll(CLE_PRIVEE)) plages.push({ debut: m.index, fin: m.index + m[0].length, par: '[SECRET]' });
    const sousUnNom = (i: number) => SOUS_UN_NOM.test(text.slice(Math.max(0, i - 160), i));
    for (const [v, champ] of formesSuresDuTri(text)) {
      if (v.length >= 8 || PARTOUT.has(champ)) apparitions(text, v, remplacement(champ, v), v.length < 8, plages);
      else apparitions(text, v, '[SECRET]', true, plages, sousUnNom);
    }
    for (const s of this.exact) apparitions(text, s, '[SECRET]', false, plages);
    for (const s of this.courtes) apparitions(text, s, '[SECRET]', true, plages);
    let out = text;
    if (plages.length) {
      const pris = new Uint8Array(text.length + 1), gardees: Plage[] = [];
      for (const p of plages.sort((a, b) => (b.fin - b.debut) - (a.fin - a.debut) || a.debut - b.debut)) {
        if (pris.subarray(p.debut, p.fin).includes(1)) continue;
        pris.fill(1, p.debut, p.fin);
        gardees.push(p);
      }
      gardees.sort((a, b) => a.debut - b.debut);
      out = '';
      let k = 0;
      for (const p of gardees) { out += text.slice(k, p.debut) + p.par; k = p.fin; }
      out += text.slice(k);
    }
    for (const re of PATTERNS) out = out.replace(re, (m) => (estSecret(re, m) ? '[SECRET]' : m));
    return masquerIdentites(out);
  }

  /** Construit un masqueur à partir des variables d'environnement sensibles. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): Redactor {
    const values = Object.entries(env)
      // Aussi les secrets dont le nom ne le dit pas : adresse iCal secrète, identifiant Twilio, cx Google.
      .filter(([k]) => /KEY|TOKEN|SECRET|PASSWORD|_SID$|ICS_URL|_CX$/i.test(k))
      .map(([, v]) => v ?? '');
    return new Redactor(values);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Les numéros d'identité : masqués SEULEMENT quand ils sont annoncés (« numéro de passeport : … », « SSN … », « DNI: … »).
// Un numéro sans annonce reste (une référence de commande lui ressemble). Le shimaoré et le kibushi n'ont pas de mots
// propres ici (rien n'est inventé) ; les mots repris du français y sont reconnus comme ailleurs.
const PIECES = [
  'passeports?', 'passports?', 'pasaportes?', 'passaport[oi]', 'passaportes?', 'reisepass(?:nummer)?', 'paspoort(?:nummer)?', 'paszport(?:u)?', 'паспорт(?:а)?', 'pasipoti', 'جواز (?:ال)?سفر', '护照', '護照', 'パスポート', '여권',
  'cartes? d[\'’]identit[ée]', 'cni', 'identity card', 'id card', 'national id', 'documento (?:nacional )?de identidad', 'dni', 'carta d[\'’]identit[àa]', 'personalausweis(?:nummer)?', 'ausweisnummer', 'identiteitskaart', 'dow[óo]d osobisty', 'carteira de identidade', 'kitambulisho', 'بطاقة (?:ال)?هوية', '身份证', '身分證', 'マイナンバー', '주민등록번호', 'kimlik (?:no|numarası)',
  's[ée]curit[ée] sociale', 's[ée]cu', 'nir', 'social security', 'ssn', 'seguridad social', 'sozialversicherungsnummer', 'burgerservicenummer', 'bsn', 'pesel', 'cpf', 'nif', 'codice fiscale', 'steuer-?id', 'num[ée]ro fiscal', 'tax id',
  'permis de conduire', 'driver[\'’]?s? licen[cs]e', 'licencia de conducir', 'f(?:ü|ue)hrerschein(?:nummer)?', 'carta de condu[çc][ãa]o', 'titre de s[ée]jour', 'residence permit', 'aufenthaltstitel',
].join('|');
const H = '[^\\S\\r\\n]';
const NUMERO = '(?:number|no\\.?|n[°º]|nr\\.?|num[ée]ro|n[úu]mero|numero|nummer|numer|номер|号码|號碼|番号|번호)';
const SEPARATEUR = `(?:${H}{0,4}[:=#：]|${H}{1,4}(?:est|is|es|ist|é|è|lautet|wynosi|ni|это)(?![\\p{L}])(?:${H}{1,4}(?:le|la|the|el|der|die))?)?${H}{0,4}`;
const ANNONCE_IDENTITE = new RegExp(`(?<!${LETTRE})(?:${PIECES})(?!${LETTRE})(?:${H}{0,4}${NUMERO}(?![\\p{L}]))?${SEPARATEUR}`, 'giu');
const GROUPE = /[A-Z0-9]{1,12}/y, ENTRE_GROUPES = /[ .\-/](?=[A-Z0-9])/y;
const DATE = /^(?:\d{1,2}[./-]\d{1,2}[./-](?:\d{2}|\d{4})|\d{4}[./-]\d{1,2}[./-]\d{1,2})$/;

/** Le numéro qui suit une annonce, en groupes (majuscules et chiffres, séparés par une espace, un point, un tiret). */
function numeroApres(t: string, i: number): number | undefined {
  let k = i, fin = i;
  for (let n = 0; n < 8; n++) {
    GROUPE.lastIndex = k;
    const g = GROUPE.exec(t);
    if (!g || (!/\d/.test(g[0]) && g[0].length > 2)) break;
    fin = k + g[0].length;
    ENTRE_GROUPES.lastIndex = fin;
    if (!ENTRE_GROUPES.exec(t)) break;
    k = fin + 1;
  }
  if (fin === i || /[\p{L}\p{N}]/u.test(t[fin] ?? '')) return undefined;
  const v = t.slice(i, fin);
  return (v.match(/\d/g)?.length ?? 0) >= 5 && !DATE.test(v) ? fin : undefined;
}
function masquerIdentites(t: string): string {
  let out = '', k = 0;
  for (const m of t.matchAll(ANNONCE_IDENTITE)) {
    const i = (m.index ?? 0) + m[0].length;
    if (i < k) continue;
    const fin = numeroApres(t, i);
    if (fin === undefined) continue;
    out += t.slice(k, i) + '[SECRET]';
    k = fin;
  }
  return k ? out + t.slice(k) : t;
}

// ---------------------------------------------------------------------------------------------------------------
// Le masqueur nourri au démarrage : ce qu'il doit connaître est relu chaque fois, et gardé en mémoire vive seulement.

/** Les clés reçues dans un message et rangées par `rangerClesRecues` (coffre fermé ou illisible : aucune). Ne lève jamais. */
export function chargerClesRecues(home: string): string[] {
  try {
    const liste: unknown = JSON.parse(readSecretFile(join(home, 'secrets-cles-recues.json')) ?? '[]');
    return Array.isArray(liste) ? liste.map((x) => (x as { cle?: unknown })?.cle).filter((c): c is string => typeof c === 'string' && c.length > 0) : [];
  } catch { return []; }
}

/**
 * Les valeurs d'un coffre de mots de passe (éléments de Thésauros) que le masqueur commun doit connaître : celles du
 * PROPRIÉTAIRE seulement (un élément marqué `membre` est le coffre d'un membre : il ne sert pas à masquer le texte des
 * autres). Mot de passe, anciens mots de passe, secret 2FA, autres champs rangés (clé, jeton, code…). Pas l'identifiant,
 * l'adresse ni les notes : ce ne sont pas des secrets à cacher dans tout le texte. Pur.
 */
export function valeursDuCoffreProprietaire(items: unknown): string[] {
  const out = new Set<string>();
  const ajouter = (v: unknown) => { if (typeof v === 'string' && v) out.add(v); };
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const x = it as { membre?: unknown; password?: unknown; totp?: unknown; champs?: unknown; history?: unknown };
    if (x.membre) continue;
    ajouter(x.password);
    ajouter(x.totp);
    if (x.champs && typeof x.champs === 'object') for (const v of Object.values(x.champs as Record<string, unknown>)) ajouter(v);
    if (Array.isArray(x.history)) for (const h of x.history) ajouter((h as { password?: unknown })?.password);
  }
  return [...out];
}

// ---------------------------------------------------------------------------------------------------------------
// U6 — aucun secret en clair, ni à l'entrée ni dans un mail lu.

/** Une clé reconnue dans un message entrant (avant l'enregistrement et le modèle) : retirée du texte. Pur. */
export function extraireCles(text: string): { text: string; cles: string[] } {
  const cles: string[] = [];
  let out = text;
  // les motifs de clés (pas le « mot de passe : … », traité à part par l'appairage des machines)
  for (const re of PATTERNS.slice(0, 9)) out = out.replace(new RegExp(re.source, re.flags), (m) => { if (!estSecret(re, m)) return m; cles.push(m); return '[clé mise au coffre]'; });
  return { text: out, cles };
}

// Seulement une ligne qui parle de connexion, de vérification ou d'usage unique — pas « code postal », « commande »…
const CODE_CONTEXTE = /(v[ée]rification|verification|verify|otp|one[- ]time|usage unique|connexion|connecter|login|log in|sign[- ]?in|2fa|two[- ]factor|double authentification|authentification|authentication|passcode|code de s[ée]curit[ée]|security code|code d'acc[èe]s|access code|mot de passe temporaire|temporary password)/i;
const PAS_UN_CODE = /(code postal|postal code|zip|commande|order|facture|invoice|client|customer|colis|parcel|suivi|tracking|r[ée]f[ée]rence|reference)/i;
const MOTS_DU_LIEN = /reset|r[ée]initiali|password|passwd|mot-de-passe|verify|v[ée]rif|magic|token|otp|login|signin|confirm/i;
/** Dans un mail lu : les codes à usage unique et les liens de réinitialisation sont masqués (Odin dit qu'un code est arrivé, sans le lire). Pur. */
export function masquerCodes(text: string): string {
  return text.split('\n').map((ligne) => {
    let l = ligne;
    if (CODE_CONTEXTE.test(l) && !PAS_UN_CODE.test(l)) l = l.replace(/(?<![\d.,:/-])\b\d{4,8}\b(?![\d.,:/-]|\s?(€|\$|eur|euros|%))/gi, '[code de connexion reçu — masqué]').replace(/\b[A-Z0-9]{3,4}-[A-Z0-9]{3,4}\b/g, '[code de connexion reçu — masqué]');
    // le lien entier, lu une seule fois, puis le mot cherché dedans (« http:// » répété sur une ligne coûtait le carré)
    l = l.replace(/https?:\/\/\S+/gi, (m) => (MOTS_DU_LIEN.test(m) ? '[lien de connexion ou de réinitialisation — masqué]' : m));
    return l;
  }).join('\n');
}

/** Range au coffre (chiffré) les clés reçues dans un message ; rend leur référence. Ne lève jamais. */
export function rangerClesRecues(home: string, cles: string[], now = Date.now()): string[] {
  try {
    const f = join(home, 'secrets-cles-recues.json');
    let liste: Array<{ cle: string; at: number }> = [];
    try { liste = JSON.parse(readSecretFile(f) ?? '[]') as Array<{ cle: string; at: number }>; } catch { liste = []; }
    const refs: string[] = [];
    for (const c of cles) { liste.push({ cle: c, at: now }); refs.push(`cle-recue:${liste.length}`); }
    writeSecretFile(f, JSON.stringify(liste.slice(-50)));
    return refs;
  } catch { return []; }
}
