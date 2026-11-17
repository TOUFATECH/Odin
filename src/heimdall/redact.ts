import { join } from 'node:path';
import { readSecretFile, writeSecretFile } from '../vault.ts';
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
const VERBES = '\\s(?:est|is|es|ist|é|è|era|was|lautet|wordt|jest|это|هي)(?![\\p{L}])|\\s*[:=：—]|是|は|는';
const VALEUR = '[^\\s"\'«»“”,;]'; // (« ! » et « . » peuvent être dans un mot de passe)
// La garde « pas une lettre autour » ne vaut que pour les écritures à espaces (pas pour le chinois, le japonais…) ;
// « _ » compte comme une lettre (MQTT_PASSWORD=… est une variable, laissée à la règle des variables).
const LETTRE = '[\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}\\p{Script=Arabic}\\p{N}_]';
export const PHRASE_MOT_DE_PASSE = new RegExp(
  `(?<=(?<!${LETTRE})(?:${MOTS_DE_PASSE})(?!${LETTRE})[^\\n.;!?]{0,40}?(?:${VERBES})\\s*["'«“]?\\s*)(?=${VALEUR}*\\p{L})(?=${VALEUR}*(?:\\p{N}|[\\p{S}@#%&*_!?]${VALEUR}))${VALEUR}{3,}`, 'giu');

const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,                 // Anthropic
  // OpenAI / OpenRouter : pas au milieu d'un mot (« desk-booking-… »), et une vraie clé a des chiffres et des majuscules.
  /(?<![A-Za-z0-9])sk-(?:proj-|or-v1-)?(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,                // GitHub
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /AKIA[0-9A-Z]{16}/g,                          // AWS
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,              // Slack
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,            // Telegram bot
  /AIza[0-9A-Za-z_-]{35}/g,                     // Google
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(?<=\b(?:password|passwd|secret|api[_-]?key|token)\s*[=:]\s*["']?)[^\s"']{6,}/gi,
  /(?<=Bearer\s)[A-Za-z0-9._~+/=-]{20,}/g,
  PHRASE_MOT_DE_PASSE,
];

export class Redactor {
  private exact: string[];

  /** `knownSecrets` : valeurs réelles (variables d'environnement) à masquer à coup sûr. */
  constructor(knownSecrets: string[] = []) {
    this.exact = knownSecrets.filter((s) => s && s.length >= 8);
  }

  /** Ajoute un secret saisi en cours de route (ex. clé enregistrée depuis l'interface web). */
  add(secret: string): void {
    if (secret && secret.length >= 8 && !this.exact.includes(secret)) this.exact.push(secret);
  }

  redact(text: string): string {
    let out = text;
    for (const s of this.exact) out = out.split(s).join('[SECRET]');
    for (const re of PATTERNS) out = out.replace(re, '[SECRET]');
    return out;
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
// U6 — aucun secret en clair, ni à l'entrée ni dans un mail lu.

/** Une clé reconnue dans un message entrant (avant l'enregistrement et le modèle) : retirée du texte. Pur. */
export function extraireCles(text: string): { text: string; cles: string[] } {
  const cles: string[] = [];
  let out = text;
  // les motifs de clés (pas le « mot de passe : … », traité à part par l'appairage des machines)
  for (const re of PATTERNS.slice(0, 9)) out = out.replace(new RegExp(re.source, re.flags), (m) => { cles.push(m); return '[clé mise au coffre]'; });
  return { text: out, cles };
}

// Seulement une ligne qui parle de connexion, de vérification ou d'usage unique — pas « code postal », « commande »…
const CODE_CONTEXTE = /(v[ée]rification|verification|verify|otp|one[- ]time|usage unique|connexion|connecter|login|log in|sign[- ]?in|2fa|two[- ]factor|double authentification|authentification|authentication|passcode|code de s[ée]curit[ée]|security code|code d'acc[èe]s|access code|mot de passe temporaire|temporary password)/i;
const PAS_UN_CODE = /(code postal|postal code|zip|commande|order|facture|invoice|client|customer|colis|parcel|suivi|tracking|r[ée]f[ée]rence|reference)/i;
/** Dans un mail lu : les codes à usage unique et les liens de réinitialisation sont masqués (Odin dit qu'un code est arrivé, sans le lire). Pur. */
export function masquerCodes(text: string): string {
  return text.split('\n').map((ligne) => {
    let l = ligne;
    if (CODE_CONTEXTE.test(l) && !PAS_UN_CODE.test(l)) l = l.replace(/(?<![\d.,:/-])\b\d{4,8}\b(?![\d.,:/-]|\s?(€|\$|eur|euros|%))/gi, '[code de connexion reçu — masqué]').replace(/\b[A-Z0-9]{3,4}-[A-Z0-9]{3,4}\b/g, '[code de connexion reçu — masqué]');
    l = l.replace(/https?:\/\/\S*(reset|r[ée]initiali|password|passwd|mot-de-passe|verify|v[ée]rif|magic|token|otp|login|signin|confirm)\S*/gi, '[lien de connexion ou de réinitialisation — masqué]');
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
