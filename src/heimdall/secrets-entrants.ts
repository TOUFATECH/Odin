// Heimdall — le tri des secrets ENTRANTS (un message d'humain, avant qu'il soit écrit nulle part).
// Demande du propriétaire (19/11) : un secret envoyé dans la conversation va au coffre, il est retiré du texte, et le
// texte gardé est celui sans le secret ; Odin reconnaît de lui-même, d'après la conversation, un mot de passe ou un
// identifiant.
//
// Ce fichier ne fait QUE reconnaître et remplacer : fonction pure, rien n'est écrit, rien n'est journalisé, aucune valeur
// n'est gardée ailleurs que dans le résultat rendu. Le rangement au coffre et le branchement à l'entrée viennent après.
//
// Trois niveaux :
//   1. les formes sûres, vérifiables : clés et jetons connus (préfixes publics), adresse avec mot de passe, Wi-Fi en QR,
//      secret 2FA, clé privée, variable de réglages, carte (clé de Luhn), IBAN (calcul modulo 97), phrase de
//      récupération (liste publique de 2048 mots et sa somme de contrôle), valeur déjà au coffre (donnée en empreintes,
//      jamais en clair) ;
//   2. les secrets annoncés : un mot-clé (mot de passe, identifiant, code PIN, clé Wi-Fi, clé d'API…) en plusieurs
//      langues, puis la valeur ; TOUS ceux du message ;
//   3. d'après la conversation : la réponse à une question d'Odin qui demandait un secret ; une forme
//      « identifiant / mot de passe » quand un sujet (la box, le Wi-Fi, un site) est nommé. Classés « probable ».
//
// Toutes les expressions sont sans retour arrière catastrophique : quantificateurs bornés, ou ancrés au début d'un mot
// (une seule tentative par mot). Un texte plus long que LONGUEUR_MAX n'est pas trié : il n'est pas rendu non plus.
// Limites connues : un secret en mots simples sans annonce ni question, coupé en deux messages, épelé, en homoglyphes
// ou dans une image n'est pas reconnu. Le shimaoré et le kibushi n'ont pas de mots-clés propres ici (rien n'est inventé :
// ils viendront de la matière écrite par des personnes qui les parlent) ; les mots repris du français (« mot de passe »,
// « code PIN », « wifi ») y sont reconnus comme ailleurs.
import { createHash, createHmac } from 'node:crypto';

export interface SecretTrouve {
  /** Le nom sous lequel le ranger (« Box », « Wi-Fi », « OpenAI », un domaine…) : jamais une partie de la valeur. */
  nom: string;
  /** Ce que c'est : « mot de passe », « identifiant », « clé d'API », « carte bancaire », « IBAN »… */
  champ: string;
  valeur: string;
  niveau: 1 | 2 | 3;
  /** Vrai pour les formes sûres (niveau 1) et les secrets annoncés (niveau 2) ; faux = « probable » (niveau 3). */
  sur: boolean;
}

export interface ContexteTri {
  /** Les derniers messages du fil (de la personne et d'Odin), du plus ancien au plus récent : pour le sujet. */
  derniersMessages?: readonly string[];
  /** La dernière question d'Odin à cette personne, s'il en a posé une juste avant ce message. */
  questionOdin?: string;
  /** Les valeurs déjà au coffre, en empreintes seulement (empreinteSecret avec le même sel). */
  coffre?: { sel: string; valeurs: ReadonlyArray<{ empreinte: string; nom: string; champ: string }> };
  /** Pour nommer un secret sans sujet (« Reçu le … »). */
  maintenant?: Date;
}

export interface ResultatTri {
  /** Le texte où chaque secret est remplacé par « [rangé au coffre : nom — champ] ». */
  texte: string;
  secrets: SecretTrouve[];
  /** Le texte dépassait LONGUEUR_MAX, ou portait plus de SECRETS_MAX secrets : il n'est ni trié ni rendu. */
  tropLong?: true;
}

/** Au-delà, le texte n'est pas trié (et pas rendu : rien ne passe sans tri). */
export const LONGUEUR_MAX = 200_000;
export const TEXTE_TROP_LONG = '[message trop long pour être trié : non gardé]';
/** Au-delà, le message n'est pas rendu non plus (un tel message n'est pas une conversation ; le trier coûterait trop). */
export const SECRETS_MAX = 256;
export const TEXTE_TROP_DE_SECRETS = '[message avec trop de secrets pour être trié : non gardé]';
/** Le remplacement d'un secret dans le texte. */
export const marque = (nom: string, champ: string): string => `[rangé au coffre : ${nom} — ${champ}]`;

/** L'empreinte d'une valeur du coffre (HMAC-SHA-256 avec un sel choisi par l'appelant) : ce que reçoit le contexte. */
export function empreinteSecret(valeur: string, sel: string): string {
  return createHmac('sha256', sel).update(valeur, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------------------------------------------
// Les briques

type Niveau = 1 | 2 | 3;
interface Trouve { debut: number; fin: number; valeur: string; champ: string; niveau: Niveau; nom?: string; qualif?: string; f?: Famille; appui?: true; long?: true }
interface Plage { debut: number; fin: number }

// « Une lettre autour » : seulement pour les écritures à espaces (pas le chinois, le japonais, le coréen, où les mots se
// suivent sans espace) ; « _ » compte comme une lettre (MQTT_PASSWORD est une variable, laissée à sa propre forme).
const LETTRE = '[\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}\\p{Script=Arabic}\\p{Script=Devanagari}\\p{N}_]';
// Les écritures sans espaces : une valeur s'y arrête (« パスワードはAbc123です » → Abc123).
const SANS_ESPACES = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}。、，！？：；（）';
const MOT_VALEUR = new RegExp(`[^\\s${SANS_ESPACES}]{1,4096}`, 'uy');
/** Une espace sur la ligne, insécables comprises (pas un retour). */
const H = '[^\\S\\r\\n]';
const OUVRANTES: Record<string, string> = { '"': '"', '\'': '\'', '«': '»', '“': '”', '‘': '’', '`': '`', '„': '“' };

const STOP = new Set((
  // fr
  'oublié oublie oubliée perdu perdue changé change changer modifié incorrect incorrecte faux fausse invalide expiré expirée requis ' +
  'obligatoire inconnu vide aucun aucune rien voir ci-dessous dessous dessus idem même pareil le la les un une des du de mon ma mes ' +
  'ton ta tes son sa ses notre votre leur ce cet cette ça ca est et ou qui que quoi pas oui non trop court long faible fort sécurisé ' +
  'robuste nouveau nouvelle ancien ancienne temporaire actuel svp stp merci ici là bon bonne mauvais demandé envoyé toujours jamais ' +
  'encore aussi déjà pris utilisé disponible ' +
  // en
  'forgot forgotten lost changed reset wrong invalid expired required unknown empty none n/a see below above same the a an my ' +
  'your his her our their this that is and or not yes no too short weak strong new old temporary current please thanks here ' +
  'correct needed sent missing always never still again already also taken used available ' +
  // es, de, it, pt, sw, ar
  'olvidé olvidado olvidada perdido cambiado incorrecta inválida requerida mi tu su el los las una es y o sí nueva nuevo ' +
  'vergessen falsch geändert ungültig erforderlich mein meine dein das der die ein eine ist und oder nicht ja nein neu neues ' +
  'dimenticato dimenticata sbagliata sbagliato cambiata il lo mio mia è e non nuova ' +
  'esqueci esquecida errada errado alterada meu minha é ou não sim ' +
  'nimesahau imesahaulika si sio ndiyo hapana yangu mpya ' +
  'نسيت خطأ خاطئة جديدة'
).split(/\s+/));

const DATE_HEURE_MONTANT = /^(?:\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{1,4})?|\d{1,2}[h:]\d{2}|[\d\s.,]+(?:€|\$|£|eur|usd|%|kmf))$/i;
const aDesLettres = (v: string) => /\p{L}/u.test(v);
const aDesChiffres = (v: string) => /\p{N}/u.test(v);
// L'apostrophe et le trait d'union sont dans les mots (« c'est », « Zèbre-Orange ») : pas des signes ici.
const aUnSigne = (v: string) => /[^\p{L}\p{N}\s'’-]/u.test(v.slice(0, -1)) || /[^\p{L}\p{N}\s.,;:!?)\]}»"'”’-]$/u.test(v);
/** A l'air d'un secret : une lettre, et un chiffre ou un signe ; ou une majuscule au milieu. Ni date, ni heure, ni montant, ni adresse. */
const formeDeSecret = (v: string) => v.length >= 4 && !DATE_HEURE_MONTANT.test(v) && !v.includes('://')
  && aDesLettres(v) && (aDesChiffres(v) || aUnSigne(v) || /.\p{Lu}/u.test(v));
/** Plus exigeant (valeur collée après une espace) : 6 caractères, un chiffre ou un signe ; ni chemin, ni courriel. */
const formeForte = (v: string) => v.length >= 6 && formeDeSecret(v) && (aDesChiffres(v) || aUnSigne(v))
  && !/^[/~]|\\|@.+\./.test(v);
const formeIdentifiant = (v: string) => /^[\p{L}\p{N}._@+-]{2,64}$/u.test(v) && aDesLettres(v);
const formeCode = (v: string) => /^[0-9A-Za-z#*]{3,12}$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 3 && !DATE_HEURE_MONTANT.test(v);
const estStop = (v: string) => STOP.has(v.toLowerCase().replace(/[!?]+$/, ''));

const compte = (s: string, c: string) => s.split(c).length - 1;
const FERMANTES: Record<string, string> = { ')': '(', ']': '[', '}': '{', '»': '«', '”': '“' };
/** Retire la ponctuation de fin de phrase (pas « ! » ni « ? », qui peuvent faire partie d'un mot de passe) et une fermante orpheline. */
function nettoyerFin(v: string): string {
  let s = v;
  for (let n = 0; n < 8; n++) {
    const avant = s;
    s = s.replace(/[.,;:]+$/u, '');
    const f = s.at(-1) ?? '';
    if (s.length > 1 && FERMANTES[f] && compte(s, FERMANTES[f]) < compte(s, f)) s = s.slice(0, -1);
    else if (s.length > 1 && (f === '"' || f === '\'' || f === '’') && compte(s, f) % 2 === 1) s = s.slice(0, -1);
    if (s === avant) break;
  }
  return s;
}

/** La valeur qui commence à `i` : entre guillemets (espaces permises, une ligne), sinon un mot. */
const MOT_IDENTIFIANT = /[\p{L}\p{N}._@+-]{1,128}/uy;
/** Un identifiant : entre guillemets, sinon lettres, chiffres, « . _ @ + - » (il s'arrête à « / » : « admin/X »). */
function lireIdentifiant(t: string, i: number): Trouve | undefined {
  if (t[i] !== undefined && OUVRANTES[t[i]]) return lireValeur(t, i);
  MOT_IDENTIFIANT.lastIndex = i;
  const m = MOT_IDENTIFIANT.exec(t);
  const v = m ? nettoyerFin(m[0]) : '';
  // Collé à autre chose qu'une barre ou une fin de phrase : c'est un seul mot, lu en entier (jamais coupé en deux).
  const apres = t[i + v.length];
  if (v && apres !== undefined && !/[\s/,;.!?)]/u.test(apres)) return lireValeur(t, i);
  return v ? { debut: i, fin: i + v.length, valeur: v, champ: '', niveau: 2 } : undefined;
}

function lireValeur(t: string, i: number): Trouve | undefined {
  const o = t[i];
  if (o !== undefined && OUVRANTES[o]) {
    const f = OUVRANTES[o], j = t.indexOf(f, i + 1), nl = t.indexOf('\n', i + 1);
    if (j > i + 1 && j - i <= 257 && (nl < 0 || j < nl)) return { debut: i + 1, fin: j, valeur: t.slice(i + 1, j), champ: '', niveau: 2 };
  }
  MOT_VALEUR.lastIndex = i;
  const m = MOT_VALEUR.exec(t);
  if (!m) return undefined;
  const v = nettoyerFin(m[0]);
  if (!v) return undefined;
  const x: Trouve = { debut: i, fin: i + v.length, valeur: v, champ: '', niveau: 2 };
  if (m[0].length === 4096 && v.length === 4096 && /[^\s]/u.test(t[MOT_VALEUR.lastIndex] ?? ' ')) x.long = true;
  return x;
}

/** Une valeur plus longue que la lecture bornée : prolongée jusqu'à la fin du mot, une fois (`memo` garde la fin déjà vue). */
function prolonger(t: string, x: Trouve, memo: { debut: number; fin: number }): void {
  if (!x.long) return;
  let j: number;
  if (x.fin >= memo.debut && x.fin < memo.fin) j = memo.fin;
  else { j = x.fin; while (j < t.length && !/\s/u.test(t[j])) j++; memo.debut = x.fin; memo.fin = j; }
  x.fin = j; x.valeur = t.slice(x.debut, j); delete x.long;
}

// ---------------------------------------------------------------------------------------------------------------
// Niveau 1 — les formes sûres

interface Forme { re: RegExp; nom?: string; champ: string; groupe?: number; variable?: 'env' | 'json' }
// Chaque forme commence au début d'un mot (garde à gauche) : une seule tentative par mot, même sur un texte piégé.
const FORMES: Forme[] = [
  { re: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/g, nom: 'Anthropic', champ: 'clé d\'API' },
  { re: /(?<![A-Za-z0-9])sk-(?:proj-|or-v1-)?(?=[A-Za-z0-9_-]{0,256}\d)(?=[A-Za-z0-9_-]{0,256}[A-Z])[A-Za-z0-9_-]{20,}/g, nom: 'OpenAI', champ: 'clé d\'API' },
  { re: /(?<![A-Za-z0-9_])[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, nom: 'Stripe', champ: 'clé d\'API' },
  { re: /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{30,}/g, nom: 'GitHub', champ: 'jeton' },
  { re: /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{40,}/g, nom: 'GitHub', champ: 'jeton' },
  { re: /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}/g, nom: 'GitLab', champ: 'jeton' },
  { re: /(?<![A-Za-z0-9_])hf_[A-Za-z0-9]{30,}/g, nom: 'Hugging Face', champ: 'jeton' },
  { re: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/g, nom: 'AWS', champ: 'clé d\'accès' },
  { re: /(?<![A-Za-z0-9_-])xox[abprs]-[A-Za-z0-9-]{10,}/g, nom: 'Slack', champ: 'jeton' },
  { re: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g, nom: 'Google', champ: 'clé d\'API' },
  { re: /(?<![A-Za-z0-9_:-])\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, nom: 'Telegram', champ: 'jeton' },
  { re: /(?<![A-Za-z0-9_.-])[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}(?![A-Za-z0-9_.-])/g, nom: 'Discord', champ: 'jeton' },
  { re: /(?<![A-Za-z0-9_.-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, nom: 'Jeton', champ: 'jeton' },
  { re: /(?<![A-Za-z0-9_])Bearer[ \t]{1,8}([A-Za-z0-9._~+/=-]{20,})/g, nom: 'Jeton', champ: 'jeton', groupe: 1 },
  { re: /(?<![A-Za-z0-9_])Authorization:[ \t]{0,8}Basic[ \t]{1,8}([A-Za-z0-9+/]{8,}={0,2})/gi, nom: 'Jeton', champ: 'identifiant et mot de passe', groupe: 1 },
  // Une variable de réglages (« OPENAI_API_KEY=… », « MQTT_PASSWORD: … ») : le nom de la variable nomme le secret.
  { re: /(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]{0,60}(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|PASS))[ \t]{0,8}[=:][ \t]{0,8}["']?([^\s"']{4,4096})/g, champ: 'secret', groupe: 2, variable: 'env' },
  // La même en minuscules ou mêlée (« db_password=… », « smtp_pass: … ») : un « _ » ou « - » avant le mot du secret.
  { re: /(?<![A-Za-z0-9_-])([A-Za-z][A-Za-z0-9_-]{0,60}[_-](?:key|token|secret|password|passwd|pwd|pass))[^\S\r\n]{0,8}[=:][^\S\r\n]{0,8}["']?([^\s"']{4,4096})/gi, champ: 'secret', groupe: 2, variable: 'env' },
  // « "password": "…" » (JSON, ou YAML entre guillemets) : nommé par le sujet de la phrase.
  { re: /"(password|passwd|pwd|secret|token|api_?key|access_?token|client_?secret|private_?key)"[ \t]{0,8}:[ \t]{0,8}"([^"\\\n]{4,4096})"/gi, champ: 'secret', groupe: 2, variable: 'json' },
];

/** Le champ d'après le nom d'une variable (…PASSWORD → mot de passe, …TOKEN → jeton, …KEY → clé). */
function champDeVariable(nom: string): string {
  const n = nom.toLowerCase();
  if (/(password|passwd|pwd|pass)$/.test(n)) return 'mot de passe';
  if (/token$/.test(n)) return 'jeton';
  if (/key$/.test(n)) return 'clé';
  return 'secret';
}

function formesSures(t: string, out: Trouve[]): void {
  const memo = { debut: 0, fin: 0 };
  for (const f of FORMES) {
    for (const m of t.matchAll(f.re)) {
      const g = f.groupe ?? 0, v = m[g];
      if (!v) continue;
      const d = (m.index ?? 0) + (g ? m[0].lastIndexOf(v) : 0);
      const x: Trouve = { debut: d, fin: d + v.length, valeur: v, champ: f.champ, niveau: 1, nom: f.nom };
      if (f.variable === 'env') {
        x.nom = m[1]; x.champ = champDeVariable(m[1]);
        // Une valeur plus longue que la lecture : prise jusqu'à la fin du mot (aucun morceau ne reste).
        if (v.length === 4096 && /[^\s"']/.test(t[d + v.length] ?? ' ')) { x.long = true; prolonger(t, x, memo); }
      }
      if (f.variable === 'json') x.champ = champDeVariable(m[1].replace(/_/g, ''));
      out.push(x);
    }
  }
  clesPrivees(t, out);
  adressesAvecMotDePasse(t, out);
  wifiQr(t, out);
  otpauth(t, out);
  cartes(t, out);
  ibans(t, out);
  phrasesDeRecuperation(t, out);
}

/** « -----BEGIN … PRIVATE KEY----- » jusqu'à sa fin (ou la fin du texte si elle manque) : parcours simple, linéaire. */
function clesPrivees(t: string, out: Trouve[]): void {
  const re = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const fin = /-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----/g;
    fin.lastIndex = m.index + m[0].length;
    const e = fin.exec(t), stop = e ? e.index + e[0].length : t.length;
    out.push({ debut: m.index, fin: stop, valeur: t.slice(m.index, stop), champ: 'clé privée', niveau: 1, nom: 'Clé privée' });
    re.lastIndex = stop;
  }
}

/** « https://moi:secret@hôte » : l'identifiant et le mot de passe, nommés par l'hôte. */
function adressesAvecMotDePasse(t: string, out: Trouve[]): void {
  const re = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{1,15}:\/\/([^\s:/@]{1,128}):([^\s/@]{1,256})@([A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\])/g;
  for (const m of t.matchAll(re)) {
    const i = (m.index ?? 0) + m[0].indexOf('://') + 3, hote = m[3];
    out.push({ debut: i, fin: i + m[1].length, valeur: m[1], champ: 'identifiant', niveau: 1, nom: hote });
    const j = i + m[1].length + 1;
    out.push({ debut: j, fin: j + m[2].length, valeur: m[2], champ: 'mot de passe', niveau: 1, nom: hote });
  }
  // Sans schéma (« ssh lea:X@192.0.2.10 », « mysql -u root:X@nas ») : le mot de passe doit avoir l'air d'un secret
  // (« contact:lea@example.org » est un courriel, pas un mot de passe). Classé « annoncé » (niveau 2), pas « sûr ».
  const nu = /(?<![\p{L}\p{N}._%+\-:/@\\])([A-Za-z0-9._-]{1,64}):([^\s:/@]{1,256})@([A-Za-z0-9-][A-Za-z0-9.-]{0,252}|\[[0-9A-Fa-f:.]{2,45}\])/gu;
  for (const m of t.matchAll(nu)) {
    if (!formeDeSecret(m[2]) || !formeIdentifiant(m[1])) continue;
    const i = m.index ?? 0, hote = m[3].replace(/[.-]+$/, '');
    out.push({ debut: i, fin: i + m[1].length, valeur: m[1], champ: 'identifiant', niveau: 2, nom: hote });
    const j = i + m[1].length + 1;
    out.push({ debut: j, fin: j + m[2].length, valeur: m[2], champ: 'mot de passe', niveau: 2, nom: hote });
  }
}

/** « WIFI:T:WPA;S:nom;P:clé;; » (QR du Wi-Fi) : la clé, nommée par le réseau. Les « \; » échappés sont suivis. */
function wifiQr(t: string, out: Trouve[]): void {
  const re = /WIFI:/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const champs: Record<string, Plage> = {};
    let i = m.index + 5, debut = i, cle = '';
    const borne = Math.min(t.length, i + 1024);
    for (; i < borne; i++) {
      const c = t[i];
      if (c === '\\') { i++; continue; }
      if (c === ':' && !cle && i - debut <= 2) { cle = t.slice(debut, i).toUpperCase(); debut = i + 1; continue; }
      if (c === ';' || c === '\n' || /\s/.test(c) && !cle) {
        if (cle && c === ';') champs[cle] = { debut, fin: i };
        cle = ''; debut = i + 1;
        if (c !== ';' || t[i + 1] === ';') break;
      }
    }
    const p = champs.P;
    if (p && p.fin > p.debut) {
      const s = champs.S ? t.slice(champs.S.debut, champs.S.fin).replace(/\\(.)/g, '$1') : '';
      out.push({ debut: p.debut, fin: p.fin, valeur: t.slice(p.debut, p.fin).replace(/\\(.)/g, '$1'), champ: 'clé Wi-Fi', niveau: 1, nom: s ? `Wi-Fi ${s}` : 'Wi-Fi' });
    }
    re.lastIndex = Math.max(i, m.index + 5);
  }
}

/** « otpauth://totp/…?secret=… » (double authentification) : le secret, nommé par l'émetteur. */
function otpauth(t: string, out: Trouve[]): void {
  for (const m of t.matchAll(/otpauth:\/\/[th]otp\/([^\s?]{0,256})\?(\S{1,2048})/gi)) {
    const q = m[2], s = /(?:^|&)secret=([A-Za-z2-7=]{8,512})/i.exec(q);
    if (!s) continue;
    const emetteur = /(?:^|&)issuer=([^&]{1,100})/i.exec(q)?.[1] ?? m[1].split(/:|%3A/i)[0];
    let nom = 'Double authentification';
    try { if (emetteur) nom = decodeURIComponent(emetteur).slice(0, 60); } catch { /* garde le nom par défaut */ }
    const d = (m.index ?? 0) + m[0].indexOf('?') + 1 + s.index + s[0].indexOf('=') + 1;
    out.push({ debut: d, fin: d + s[1].length, valeur: s[1], champ: 'secret 2FA', niveau: 1, nom });
  }
}

/** Clé de Luhn. */
export function luhn(chiffres: string): boolean {
  let s = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let d = chiffres.charCodeAt(chiffres.length - 1 - i) - 48;
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    s += d;
  }
  return s % 10 === 0;
}
const GROUPES_CARTE = ['4,4,4,4', '4,4,4,4,3', '4,4,4,4,2', '4,6,5', '4,6,4', '4,4,4,1', '4,4,4,3'];
const PAS_UNE_CARTE = /(commande|order|facture|invoice|colis|parcel|suivi|tracking|r[ée]f[ée]rence|reference|n[°º]|num[ée]ro de (?:client|dossier|contrat)|siret|siren|t[ée]l[ée]phone|phone|\btel\b)/i;
/** Une carte : 13 à 19 chiffres (en un bloc, ou en groupes de 4, ou 4-6-5) qui passent la clé de Luhn. Jamais après « + ». */
function cartes(t: string, out: Trouve[]): void {
  for (const m of t.matchAll(/(?<![\d+])[2-6]\d{3}(?:[ -]?\d){9,15}(?!\d)/g)) {
    const groupes = m[0].split(/[ -]/), debut = m.index ?? 0;
    const ligne = t.slice(t.lastIndexOf('\n', debut) + 1, debut).slice(-60);
    if (PAS_UNE_CARTE.test(ligne)) continue;
    for (let k = groupes.length; k >= 1; k--) {
      const g = groupes.slice(0, k), chiffres = g.join('');
      if (chiffres.length < 13 || chiffres.length > 19) continue;
      if (g.length > 1 && !GROUPES_CARTE.includes(g.map((x) => x.length).join(','))) continue;
      if (!luhn(chiffres)) continue;
      const fin = debut + g.reduce((n, x) => n + x.length, 0) + (g.length - 1);
      out.push({ debut, fin, valeur: t.slice(debut, fin), champ: 'carte bancaire', niveau: 1, nom: 'Carte bancaire' });
      break;
    }
  }
}

// Longueurs de l'IBAN par pays (registre public) : un IBAN d'un pays connu doit avoir exactement cette longueur.
const LONGUEUR_IBAN: Record<string, number> = Object.fromEntries((
  'AD24 AE23 AL28 AT20 AZ28 BA20 BE16 BG22 BH22 BR29 BY28 CH21 CR22 CY28 CZ24 DE22 DK18 DO28 EE20 EG29 ES24 FI18 FO18 FR27 ' +
  'GB22 GE22 GI23 GL18 GR27 GT28 HR21 HU28 IE22 IL23 IQ23 IS26 IT27 JO30 KW30 KZ20 LB28 LC32 LI21 LT20 LU20 LV21 MC27 MD24 ' +
  'ME22 MK19 MR27 MT31 MU30 NL18 NO15 PK24 PL28 PS29 PT25 QA29 RO24 RS22 SA24 SC31 SE24 SI19 SK24 SM27 ST25 SV28 TL23 TN24 ' +
  'TR26 UA29 VA22 VG24 XK20 ' +
  // Ajoutés plus récemment au registre, puis les pays qui emploient l'IBAN en partie (dont les Comores et Madagascar).
  'BI27 DJ27 FK18 HN28 LY25 MN20 NI28 OM23 RU33 SD18 SO23 YE30 ' +
  'AO25 BF28 BJ28 CF27 CG27 CI28 CM27 CV25 DZ26 GA27 GQ27 GW25 IR26 KM27 MA28 MG27 ML28 MZ25 NE28 SN28 TD27 TG28'
).split(' ').map((x) => [x.slice(0, 2), Number(x.slice(2))]));
/** IBAN : clé modulo 97 (les 4 premiers caractères à la fin, lettres en nombres). */
export function ibanValide(iban: string): boolean {
  const s = iban.toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  let reste = 0;
  for (const c of s.slice(4) + s.slice(0, 4)) {
    const n = c >= 'A' ? String(c.charCodeAt(0) - 55) : c;
    for (const d of n) reste = (reste * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return reste === 1;
}
function ibans(t: string, out: Trouve[]): void {
  for (const m of t.matchAll(/(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]){11,30}(?![A-Za-z0-9])/g)) {
    const brut = m[0], attendu = LONGUEUR_IBAN[brut.slice(0, 2).toUpperCase()];
    // Un pays hors registre n'est pas un IBAN (une référence au hasard passerait la clé une fois sur 97).
    if (!attendu) continue;
    // Le préfixe de la bonne longueur (sans espaces), retrouvé dans le texte.
    for (const n of [attendu]) {
      let k = 0, j = 0;
      for (; j < brut.length && k < n; j++) if (brut[j] !== ' ') k++;
      if (k < n || (j < brut.length && brut[j] !== ' ')) continue;
      const v = brut.slice(0, j);
      if (!ibanValide(v.replace(/ /g, ''))) continue;
      const debut = m.index ?? 0;
      out.push({ debut, fin: debut + v.length, valeur: v, champ: 'IBAN', niveau: 1, nom: 'IBAN' });
      break;
    }
  }
}

// La phrase de récupération (portefeuille) : 12, 15, 18, 21 ou 24 mots de la liste publique BIP-39 (anglais), dont la
// somme de contrôle est juste. La liste est recopiée telle quelle à la fin de ce fichier ; son empreinte est vérifiée par
// un essai.
export const EMPREINTE_LISTE_BIP39 = '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';
let indexBip39: Map<string, number> | undefined;
const bip39 = (): Map<string, number> => indexBip39 ??= new Map(LISTE_BIP39.map((w, i) => [w, i]));

/** Une suite d'indices (11 bits chacun) est-elle une phrase complète, somme de contrôle comprise ? */
function phraseValide(ix: number[]): boolean {
  const bits = ix.map((i) => i.toString(2).padStart(11, '0')).join('');
  const ent = (ix.length * 11 * 32) / 33, cs = ent / 32;
  const octets = Buffer.alloc(ent / 8);
  for (let i = 0; i < octets.length; i++) octets[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const h = createHash('sha256').update(octets).digest();
  return bits.slice(ent) === Array.from(h.subarray(0, 1)).map((b) => b.toString(2).padStart(8, '0')).join('').slice(0, cs);
}
function phrasesDeRecuperation(t: string, out: Trouve[]): void {
  const idx = bip39();
  const mots: Array<{ i: number; debut: number; fin: number }> = [];
  const vider = () => {
    // Dans une suite de mots de la liste : la plus longue phrase valide (24 → 12 mots), de gauche à droite.
    let a = 0;
    while (mots.length - a >= 12) {
      let prise = false;
      for (const n of [24, 21, 18, 15, 12]) {
        if (mots.length - a < n || !phraseValide(mots.slice(a, a + n).map((m) => m.i))) continue;
        const debut = mots[a].debut, fin = mots[a + n - 1].fin;
        out.push({ debut, fin, valeur: t.slice(debut, fin), champ: 'phrase de récupération', niveau: 1, nom: 'Phrase de récupération' });
        a += n; prise = true; break;
      }
      if (!prise) a++;
    }
    mots.length = 0;
  };
  // Mots séparés par des espaces, des retours, des virgules ou une numérotation (« 1. abandon 2. ability … »).
  for (const m of t.matchAll(/[A-Za-z]+|\S/g)) {
    const w = m[0];
    if (/^[A-Za-z]+$/.test(w)) {
      const i = idx.get(w.toLowerCase());
      if (i !== undefined) { mots.push({ i, debut: m.index ?? 0, fin: (m.index ?? 0) + w.length }); continue; }
      vider();
    } else if (!/^[\d.),;:-]$/.test(w)) vider();
  }
  vider();
}

/** Les valeurs déjà au coffre : chaque mot du message (et ses morceaux autour de « / », « : », « = ») comparé par empreinte. */
function valeursDuCoffre(t: string, c: ContexteTri['coffre'], out: Trouve[]): void {
  if (!c?.valeurs?.length) return;
  const connues = new Map(c.valeurs.map((v) => [v.empreinte, v]));
  for (const m of t.matchAll(/\S{6,256}/g)) {
    const base = m.index ?? 0, w = m[0];
    const net = w.replace(/^["'«“‘([]+/, ''), dn = w.length - net.length;
    const essais: Array<[number, string]> = [[0, w], [dn, nettoyerFin(net)]];
    let k = 0;
    for (const p of w.split(/([/:=])/)) { if (!/^[/:=]$/.test(p)) essais.push([k, p]); k += p.length; }
    for (const [d, v] of essais) {
      if (v.length < 6) continue;
      const e = connues.get(empreinteSecret(v, c.sel));
      if (e) { out.push({ debut: base + d, fin: base + d + v.length, valeur: v, champ: e.champ, niveau: 1, nom: e.nom }); break; }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Niveau 2 — les secrets annoncés

type Famille = 'mdp' | 'id' | 'code' | 'cle';
/**
 * `sep` : ce qui peut suivre le mot-clé avant la valeur — « s » un signe (« : », « = »), « v » un verbe (« est », « is »,
 * « ist », « は »…), « e » une simple espace (alors la valeur doit avoir une forme nette). `forme` : même après « : », la
 * valeur doit avoir l'air d'un secret.
 */
interface MotCle { f: Famille; champ: string; mots: string[]; sep: 's' | 'sv' | 'sve'; forme?: true; ambigu?: true }
// `ambigu` : un mot-clé court qui sert aussi dans des phrases ordinaires (« User: Bonjour », « Pass Navigo ») : sa valeur
// n'est gardée que si elle a l'air d'un secret, ou qu'elle fait la paire avec un mot de passe (ou un identifiant) tout près.
const MOTS_CLES: MotCle[] = [
  { f: 'mdp', champ: 'clé Wi-Fi', sep: 'sve', mots: ['cl[ée]s? (?:du |de |d[ue] la )?wi-?fi', 'cl[ée]s? wpa2?', 'cl[ée] de s[ée]curit[ée] (?:du )?r[ée]seau', 'codes? (?:du |de )?wi-?fi', 'wi-?fi (?:key|password|passcode|code)', 'wpa2? (?:key|passphrase)', 'network (?:security )?key', 'clave (?:del |de )?wi-?fi', 'wlan-?(?:passwort|schl(?:ü|ue)ssel|kennwort)', 'netzwerkschl(?:ü|ue)ssel', 'chiave (?:del |di )?wi-?fi', 'chave (?:do )?wi-?fi'] },
  { f: 'mdp', champ: 'mot de passe', sep: 'sve', mots: ['mots? de passe', 'mots?-de-passe', 'mdp', 'pass ?words?', 'passwd', 'passcode', 'pass ?phrase', 'contrase(?:ñ|n)as?', 'passw(?:ö|o)rt(?:er)?', 'kennw(?:ö|o)rt', 'senhas?', 'wachtwoord(?:en)?', 'parola d[\'’]ordine', 'has(?:ł|l)o', 'парол(?:ь|я|ем)', 'şifre', 'sifre', 'kata sandi', 'kata laluan', 'nenosiri', 'neno (?:la )?siri', 'كلمة (?:ال)?(?:مرور|سر)', 'رمز (?:ال)?عبور', '密码', '密碼', '口令', 'パスワード', '비밀번호', '암호', 'tenimiafina', 'teny miafina', 'पासवर्ड', 'mật khẩu', 'lösenord', 'adgangskode', 'salasana'] },
  { f: 'mdp', champ: 'mot de passe', sep: 's', ambigu: true, mots: ['pass', 'pwd', 'pw', 'clave', 'parola'] },
  { f: 'id', champ: 'identifiant', sep: 'sv', mots: ['identifiants?(?: de connexion)?', 'nom d[\'’]utilisateur', 'username', 'user ?name', 'nombre de usuario', 'benutzername', 'anmeldename', 'nome utente', 'nome de usu[áa]rio', 'gebruikersnaam', 'имя пользователя', 'логин', 'jina la mtumiaji', 'اسم المستخدم', 'ユーザー?名', 'ユーザーID', '用户名', '用戶名', '账号', '帳號', '아이디', '사용자 ?이름', 'kullanıcı adı', 'nama pengguna', 'tên đăng nhập'] },
  { f: 'id', champ: 'identifiant', sep: 's', ambigu: true, mots: ['login', 'user', 'user ?id', 'utilisateur', 'usuario', 'usu[áa]rio', 'utilizador', 'utente', 'benutzer'] },
  { f: 'code', champ: 'code PIN', sep: 'sve', mots: ['codes? pin', 'pin-?codes?', 'código pin', 'codice pin', 'пин-?код', '暗証番号', 'الرقم السري', 'n(?:amba|ambari) ya siri'] },
  { f: 'code', champ: 'code PIN', sep: 'sv', mots: ['pin', 'пин'] },
  { f: 'code', champ: 'digicode', sep: 'sve', mots: ['digicodes?', 'codes? (?:de la |du |de l[\'’])?(?:porte|portail|immeuble|entr[ée]e|b[âa]timent)', 'door ?code', 'gate code', 'código de (?:la )?puerta', 't(?:ü|ue)rcode'] },
  { f: 'code', champ: 'code d\'alarme', sep: 'sve', mots: ['codes? (?:de l[\'’]|d[\'’])alarme', 'alarm code', 'código de (?:la )?alarma'] },
  { f: 'code', champ: 'cryptogramme', sep: 'sve', mots: ['cryptogrammes?', 'cvv2?', 'cvc2?', 'card security code', 'código de seguridad'] },
  { f: 'code', champ: 'code de vérification', sep: 'sve', mots: ['codes? de (?:v[ée]rification|confirmation|connexion|s[ée]curit[ée])', 'verification code', 'security code', 'one[- ]time (?:code|password)', 'codes? (?:re[çc]us? )?par sms', 'sms code', 'código de verificaci[óo]n', 'best(?:ä|ae)tigungscode', 'codice di verifica', 'código de verifica[çc][ãa]o'] },
  { f: 'code', champ: 'code de vérification', sep: 'sv', mots: ['otp'] },
  { f: 'code', champ: 'code d\'accès', sep: 'sve', mots: ['codes? d[\'’]acc[èe]s', 'access code', 'código de acceso', 'zugangscode', 'codice d[\'’]accesso', 'codes? secrets?', 'secret code'] },
  { f: 'cle', champ: 'clé d\'API', sep: 'sve', mots: ['cl[ée]s? (?:d[\'’])?api', 'api[ _-]?keys?', 'apikey', 'access[ _-]?tokens?', 'client[ _-]?secret', 'secret[ _-]?key', 'clave (?:de )?api', 'api-schl(?:ü|ue)ssel', 'chiave api', 'chave (?:de )?api', 'مفتاح (?:ال)?api', 'api ?キー', 'api ?密钥'] },
  { f: 'cle', champ: 'jeton', sep: 's', forme: true, mots: ['tokens?', 'jetons?', 'secret'] },
  { f: 'cle', champ: 'clé', sep: 's', forme: true, mots: ['cl[ée]', 'key', 'schl(?:ü|ue)ssel', 'chiave', 'chave'] },
];
/**
 * Les espaces écrites dans un mot-clé acceptent ce qu'on tape vraiment : une à trois espaces de toute sorte (insécable,
 * fine, tabulation, retour à la ligne : « mot  de\npasse ») ; « ? » après une espace : zéro à trois.
 */
function espacesSouples(src: string): string {
  let out = '', classe = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { out += c + (src[i + 1] ?? ''); i++; continue; }
    if (classe) { if (c === ']') classe = false; out += c === ' ' ? '\\s' : c; continue; }
    if (c === '[') { classe = true; out += c; continue; }
    if (c === ' ' && src[i + 1] === '?') { out += '\\s{0,3}'; i++; continue; }
    out += c === ' ' ? '\\s{1,3}' : c;
  }
  return out;
}
// Une seule expression, les mots les plus longs d'abord (à la même place, l'alternative écrite d'abord gagne).
const ENTREES = MOTS_CLES.flatMap((m, k) => m.mots.map((src) => ({ src, k }))).sort((a, b) => b.src.length - a.src.length);
const SOURCE_MOTS = `(?<!${LETTRE})(?:${ENTREES.map((e, i) => `(?<m${i}>${espacesSouples(e.src)})`).join('|')})(?!${LETTRE})`;
const RE_MOTS = new RegExp(SOURCE_MOTS, 'giu');
const RE_MOTS_UN = new RegExp(SOURCE_MOTS, 'iu');
const motCleDe = (m: RegExpExecArray | RegExpMatchArray): MotCle => {
  const g = m.groups ?? {};
  for (let i = 0; i < ENTREES.length; i++) if (g[`m${i}`] !== undefined) return MOTS_CLES[ENTREES[i].k];
  return MOTS_CLES[0];
};

// Après le mot-clé : quelques mots (« de la box », « root », « for example.org »), puis un signe ou un verbe.
const QUALIF = '(?<q>(?:[^\\n:=：;!?.]|\\.(?=\\S)){0,48}?)';
// Les espaces sur la ligne comprennent les insécables (« mot de passe :\u00a0… », courant après « : » en français).
const SIGNE = `${H}{0,8}(?:[:=：]|=>|->|—|–)${H}{0,8}(?:\\r?\\n${H}{0,8})?`;
const VERBE = `(?:\\s{1,8}(?:c['’]\\s?est|est|sera|is|was|es|era|ist|lautet|è|é|jest|wordt|är|это|ni|هي|هو)(?![\\p{L}\\p{N}])${H}{0,8}(?:[:=]${H}{0,8})?|${H}{0,8}(?:是|は|는|은|为|為)${H}{0,8})`;
const RE_APRES = new RegExp(`${QUALIF}(?:(?<s>${SIGNE})|(?<v>${VERBE}))`, 'uy');
const RE_ESPACE = /[^\S\r\n]{1,8}/y;
const RE_BARRE = /[^\S\r\n]{0,8}\/[^\S\r\n]{0,8}/y;
const RE_ENTRE_VALEURS = /[^\S\r\n]{0,8}\/[^\S\r\n]{0,8}|[^\S\r\n]{1,8}/y;
/** Un mot qui annonce l'encodage de la valeur (« mdp : base64 UWs5… ») : la valeur est le mot suivant. */
const ENCODAGE = /^(?:base64|b64|hex|hexa)$/i;

/** Rend « oui », « appui » (gardée seulement en paire avec un mot de passe ou un identifiant tout près) ou « non ». */
function valeurAcceptee(mc: MotCle, v: string, sep: 's' | 'v' | 'e'): 'oui' | 'appui' | 'non' {
  if (!v || estStop(v)) return 'non';
  if (mc.f === 'code') return formeCode(v) ? 'oui' : 'non';
  if (mc.f === 'id') {
    if (!formeIdentifiant(v.replace(/[!?]+$/, ''))) return 'non';
    // Seul, un identifiant n'est pris qu'après un signe et un mot-clé net (« identifiant : … »), ou s'il porte un chiffre,
    // un point, « _ » ou « @ » après un verbe ; sinon il attend un mot de passe tout près (« identifiant admin, mot de
    // passe … » : les deux vont au coffre).
    if (sep === 's' && !mc.ambigu) return 'oui';
    if (sep !== 'e' && /[\d._@]/.test(v)) return 'oui';
    return 'appui';
  }
  if (mc.forme || sep === 'v') return formeDeSecret(v) && (mc.f !== 'cle' || v.length >= 8) ? 'oui' : 'non';
  if (sep === 'e') return formeForte(v) ? (mc.ambigu ? 'appui' : 'oui') : 'non';
  if (mc.f === 'cle') return v.length >= 8 ? 'oui' : 'non';
  if (v.length < 3 || DATE_HEURE_MONTANT.test(v)) return 'non';
  return mc.ambigu && !formeDeSecret(v) ? 'appui' : 'oui';
}

/**
 * Vrai si la plage [d, f) est un mot-clé du texte et non une valeur : un morceau de mot-clé (« mot » de « mot de passe »)
 * ne l'est jamais ; un mot-clé entier ne l'est que s'il annonce lui-même une valeur sur sa ligne (un signe, un verbe, ou un
 * mot qui suit). `suitePrise` : le mot qui suit est déjà la valeur d'après (« user/pass : user X ») : seuls le signe et le
 * verbe comptent alors.
 */
type DansMotCle = (d: number, f: number, suitePrise?: boolean) => boolean;
const RE_ANNONCE_SUITE = new RegExp(`^(?:${SIGNE}|${VERBE})`, 'u');
const RE_MOT_SUIVANT = /^[^\S\r\n]{1,8}(?=["'«“‘(\[\p{L}\p{N}])/u;
/**
 * Les mots-clés du texte, en un passage : « identifiant admin / mot de passe X » : « mot » n'est pas le mot de passe ;
 * « mot de passe : password » : « password » l'est. Une valeur qui prolonge un mot-clé (« Password!2024 ») reste une valeur.
 */
function motsClesDuTexte(t: string): DansMotCle {
  let ix: Int32Array | undefined;
  const debuts: number[] = [0], fins: number[] = [0];
  for (const m of t.matchAll(RE_MOTS)) {
    const d = m.index ?? 0, f = d + m[0].length;
    ix ??= new Int32Array(t.length + 1);
    debuts.push(d); fins.push(f); ix.fill(debuts.length - 1, d, f);
  }
  return (d, f, suitePrise = false) => {
    if (!ix || f <= d || ix[d] === 0 || ix[d] !== ix[f - 1]) return false;
    const k = ix[d];
    if (d !== debuts[k] || f !== fins[k]) return true;
    const nl = t.indexOf('\n', f), suite = t.slice(f, Math.min(nl < 0 ? t.length : nl, f + 64));
    if (RE_ANNONCE_SUITE.test(suite)) return true;
    if (suitePrise) return false;
    const e = RE_MOT_SUIVANT.exec(suite);
    if (!e) return false;
    // Le mot qui suit est lui-même un autre mot-clé (« identifiant user mot de passe X ») : celui-ci n'annonce rien.
    const j = f + e[0].length;
    return !(ix[j] !== 0 && debuts[ix[j]] === j);
  };
}

/** Le mot de passe qui suit un identifiant (« admin / X » ou, après « login/pass », « admin X ») : rendu ou undefined. */
function motDePasseApres(t: string, i: number, barreSeule: boolean, dansMotCle: DansMotCle): Trouve | undefined {
  const re = barreSeule ? RE_BARRE : RE_ENTRE_VALEURS;
  re.lastIndex = i;
  if (!re.exec(t)) return undefined;
  const v = lireValeur(t, re.lastIndex);
  if (!v || v.valeur.length < 3 || estStop(v.valeur) || DATE_HEURE_MONTANT.test(v.valeur)) return undefined;
  // « admin7 / mot de passe X » : un mot-clé suit, pas la valeur ; il sera lu à son tour.
  if (dansMotCle(v.debut, v.fin)) return undefined;
  return { ...v, champ: 'mot de passe', niveau: 2 };
}

function annonces(t: string, out: Trouve[], dansMotCle: DansMotCle): void {
  RE_MOTS.lastIndex = 0;
  const pris: Trouve[] = [], memo = { debut: 0, fin: 0 };
  let m: RegExpExecArray | null;
  while ((m = RE_MOTS.exec(t))) {
    const mc = motCleDe(m), apres = m.index + m[0].length;
    // « login/pass : admin / X » ou « user/pass admin X » : deux mots-clés, deux valeurs.
    let deuxMots = false, debutValeurs = apres;
    if (mc.f === 'id') {
      RE_BARRE.lastIndex = apres;
      if (RE_BARRE.exec(t)) {
        const j = RE_BARRE.lastIndex;
        const m2 = RE_MOTS_UN.exec(t.slice(j, j + 40));
        if (m2 && m2.index === 0 && motCleDe(m2).f === 'mdp') { deuxMots = true; debutValeurs = j + m2[0].length; }
      }
    }
    let sep: 's' | 'v' | 'e' | undefined, i = debutValeurs, qualif = '';
    RE_APRES.lastIndex = debutValeurs;
    let a = RE_APRES.exec(t);
    // Un qualificatif qui contient lui-même un autre mot-clé (« mot de passe oublié, code PIN : … ») : la valeur est à
    // lui. Pour un identifiant (« login admin pass: … »), la valeur est peut-être juste après, séparée d'une espace.
    if (a && a.groups?.q && RE_MOTS_UN.test(a.groups.q)) { if (mc.f !== 'id') continue; a = null; }
    if (a) { sep = a.groups?.s !== undefined ? 's' : 'v'; i = RE_APRES.lastIndex; qualif = a.groups?.q ?? ''; }
    else if (mc.sep === 'sve' || deuxMots || mc.f === 'id' || mc.ambigu) { RE_ESPACE.lastIndex = debutValeurs; if (RE_ESPACE.exec(t)) { sep = 'e'; i = RE_ESPACE.lastIndex; } }
    if (!sep || (sep === 'v' && mc.sep === 's' && mc.f !== 'id')) continue;
    let val = mc.f === 'id' ? lireIdentifiant(t, i) : lireValeur(t, i);
    if (!val) continue;
    // « mdp : base64 UWs5… » : la valeur est le mot qui suit l'encodage.
    if (mc.f !== 'id' && ENCODAGE.test(val.valeur)) { RE_ESPACE.lastIndex = val.fin; const n = RE_ESPACE.exec(t) ? lireValeur(t, RE_ESPACE.lastIndex) : undefined; if (n) val = n; }
    // La « valeur » est elle-même un mot-clé (« wifi password: password X ») : ce mot-clé sera lu à son tour.
    if (dansMotCle(val.debut, val.fin, deuxMots)) continue;
    if (deuxMots) {
      const pw = formeIdentifiant(val.valeur) && !estStop(val.valeur) ? motDePasseApres(t, val.fin, false, dansMotCle) : undefined;
      if (!pw) continue;
      prolonger(t, pw, memo);
      pris.push({ ...val, champ: 'identifiant', niveau: 2, qualif, f: 'id' }, { ...pw, qualif, f: 'mdp' });
      RE_MOTS.lastIndex = Math.max(RE_MOTS.lastIndex, pw.fin);
      continue;
    }
    const verdict = valeurAcceptee(mc, val.valeur, sep);
    if (verdict === 'non') continue;
    if (mc.f !== 'id') prolonger(t, val, memo);
    const x: Trouve = { ...val, champ: mc.champ, niveau: 2, qualif, f: mc.f };
    if (verdict === 'appui') x.appui = true;
    pris.push(x);
    let fin = val.fin;
    // « identifiant : admin / X » : le mot de passe suit l'identifiant (les deux sont gardés).
    if (mc.f === 'id') {
      const pw = motDePasseApres(t, val.fin, true, dansMotCle);
      if (pw) { prolonger(t, pw, memo); delete x.appui; pris.push({ ...pw, qualif, f: 'mdp' }); fin = pw.fin; }
    }
    RE_MOTS.lastIndex = Math.max(RE_MOTS.lastIndex, fin);
  }
  // Les valeurs « en appui » : gardées seulement si un mot de passe (pour un identifiant) ou un identifiant (pour un
  // mot de passe) est tout près — même ligne ou ligne voisine, à 160 caractères au plus.
  const estMdp = (x: Trouve) => x.f === 'mdp' || x.champ === 'mot de passe';
  const estId = (x: Trouve) => x.f === 'id' || x.champ === 'identifiant';
  const tous = [...out, ...pris];
  const mdps = tous.filter(estMdp).sort((p, q) => p.debut - q.debut);
  const ids = tous.filter(estId).sort((p, q) => p.debut - q.debut);
  for (const x of pris) {
    if (!x.appui) { out.push(x); continue; }
    if (aUnVoisin(t, x, x.f === 'id' ? mdps : ids)) { delete x.appui; out.push(x); }
  }
}

/** Un élément de `l` (trié par début), autre que `x`, à 160 caractères au plus et à une ligne au plus de `x`. */
function aUnVoisin(t: string, x: Trouve, l: readonly Trouve[]): boolean {
  let lo = 0, hi = l.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (l[mid].debut < x.debut) lo = mid + 1; else hi = mid; }
  for (let k = Math.max(0, lo - 3); k < Math.min(l.length, lo + 3); k++) {
    const y = l[k];
    if (y === x || (y.debut === x.debut && y.fin === x.fin)) continue;
    const [a, b] = y.debut >= x.fin ? [x.fin, y.debut] : y.fin <= x.debut ? [y.fin, x.debut] : [0, 0];
    if (b - a > 160) continue;
    if (t.slice(a, b).split('\n').length - 1 <= 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Le sujet (pour nommer) : la box, le Wi-Fi, un nom de domaine, un nom propre après « de / for / … ».

const SUJETS: Array<[string, string]> = [
  ['livebox', 'Livebox'], ['freebox', 'Freebox'], ['bbox', 'Bbox'], ['box', 'Box'], ['routeur|router|enrutador|roteador', 'Routeur'],
  ['modem', 'Modem'], ['wi-?fi|wlan', 'Wi-Fi'], ['nas', 'NAS'], ['serveur|server|servidor', 'Serveur'], ['vpn', 'VPN'], ['ssh', 'SSH'],
  ['proxmox', 'Proxmox'], ['imprimante|printer|impresora|drucker|stampante', 'Imprimante'], ['cam[ée]ras?|kamera', 'Caméra'],
  ['alarmes?|alarm|alarma|allarme', 'Alarme'], ['portes?|portail|door|gate|puerta|t(?:ü|ue)r', 'Porte'], ['banque|bank|banco|banca|benki', 'Banque'],
  ['courriel|e-?mail|correo|messagerie', 'Messagerie'], ['ordinateur|computer|laptop', 'Ordinateur'],
];
const RE_SUJET = new RegExp(`(?<!${LETTRE})(?:${SUJETS.map(([s], i) => `(?<s${i}>${s})`).join('|')})(?!${LETTRE})`, 'giu');
const TLD = 'com|net|org|edu|gov|fr|eu|io|dev|co|re|yt|km|mg|mu|sc|be|ch|uk|us|ca|de|es|it|pt|nl|info|app|me|tv|ai|cloud|tech|online|xyz|biz|ma|tn|dz|sn|ci|cm|tz|ke';
const RE_DOMAINE = new RegExp(`(?<![\\p{L}\\p{N}_.@-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.){1,6}(?:${TLD})(?![\\p{L}\\p{N}_-])`, 'giu');
const RE_PROPRE = /(?:^|\s)(?:de|du|des|d['’]|of|for|para|del|für|von|di|do|da|ya|pour|de la|de l['’])\s{0,4}(?:(?:mon|ma|mes|my|the|le|la|les|l['’]|mi|mein|meine|il|o|a)\s{1,4})?(\p{Lu}[\p{L}\p{N}&+-]{1,39})/u;

interface Sujet { i: number; fin: number; nom: string }
/** Tous les sujets nommés dans `s`, dans l'ordre (un seul passage). */
function sujets(s: string): Sujet[] {
  const out: Sujet[] = [];
  for (const m of s.matchAll(RE_SUJET)) {
    const g = m.groups ?? {}, i = m.index ?? 0;
    out.push({ i, fin: i + m[0].length, nom: SUJETS[SUJETS.findIndex((_, j) => g[`s${j}`] !== undefined)][1] });
  }
  for (const m of s.matchAll(RE_DOMAINE)) out.push({ i: m.index ?? 0, fin: (m.index ?? 0) + m[0].length, nom: m[0].toLowerCase() });
  return out.sort((a, b) => a.i - b.i);
}
const sujetDans = (s: string): string | undefined => sujets(s)[0]?.nom;

/** Les caractères couverts par des plages (pour savoir en temps constant si un sujet est dans un secret). */
function masque(n: number, plages: readonly Plage[]): Uint8Array {
  const m = new Uint8Array(n + 1);
  for (const p of plages) m.fill(1, Math.max(0, p.debut), Math.min(n, p.fin));
  return m;
}
const libre = (m: Uint8Array, d: number, f: number) => { for (let i = d; i < f; i++) if (m[i]) return false; return true; };
/** Le sujet le plus proche avant `avant` (et pas avant `depuis`), hors des secrets. */
function sujetAvant(occ: readonly Sujet[], m: Uint8Array, avant: number, depuis = 0): string | undefined {
  let lo = 0, hi = occ.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (occ[mid].i < avant) lo = mid + 1; else hi = mid; }
  for (let k = lo - 1, n = 0; k >= 0 && occ[k].i >= depuis && n < 64; k--, n++) if (occ[k].fin <= avant && libre(m, occ[k].i, occ[k].fin)) return occ[k].nom;
  return undefined;
}

function nomParDefaut(c: ContexteTri): string {
  const d = c.maintenant;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return 'Reçu';
  const z = (n: number) => String(n).padStart(2, '0');
  return `Reçu le ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} à ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/** Le sujet d'après la conversation : la question d'Odin, puis les derniers messages (du plus récent au plus ancien). */
function sujetDuContexte(c: ContexteTri): string | undefined {
  const q = typeof c.questionOdin === 'string' ? sujetDans(c.questionOdin.slice(0, 4000)) : undefined;
  if (q) return q;
  const l = Array.isArray(c.derniersMessages) ? c.derniersMessages.slice(-10) : [];
  for (let i = l.length - 1; i >= 0; i--) { const s = sujetDans(String(l[i] ?? '').slice(0, 4000)); if (s) return s; }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Niveau 3 — d'après la conversation

// Une demande : un verbe qui demande (« donne », « envoie-moi », « tu peux me donner », « j'ai besoin »), ou une question
// qui porte sur la valeur (« quel est… ? », « il est où… ? »). Un « ? » seul n'en fait pas une : « Tu as changé le mot de
// passe de la box ? » ne demande rien.
const DEMANDE = /(?<![\p{L}])(?:donne|donnez|donner|envoie|envoyez|envoyer|colle|collez|coller|tape|tapez|taper|[ée]cris|[ée]crivez|[ée]crire|indique|indiquez|indiquer|dis-moi|dites-moi|me dire|besoin|give|send|paste|type|enter|tell me|share|provide|need|dame|d[ée]me|env[íi]a|env[íi]ame|enviar|escribe|necesito|gib|geben|schick|schicken|brauche|dammi|dare|invia|inviare|scrivi|serve|me d[êe]|me dá|envie|digite|preciso|nipe|nitumie|tuma|أرسل|أعطني|ارسل|اعطني)(?![\p{L}])/iu;
const QUESTION = /[?？؟]/u;
const MOT_QUESTION = /(?<![\p{L}])(?:quel|quelle|quels|quelles|c['’]est quoi|où|what|what['’]s|which|where|cu[áa]l|cu[áa]les|qué|d[óo]nde|welche[snrm]?|wie lautet|wo|qual|quale|quali|dove|onde|nini|gani|wapi|ما|ماهي|ماهو|أين|اين)(?![\p{L}])/iu;
// Les mots d'une réponse ordinaire (« demain soir », « je regarde », « merci ») : une réponse qui en contient n'est pas
// prise entière comme secret (toutes les langues suivies ne sont pas couvertes : les autres réponses restent « probables »).
const COURANTS = new Set((
  // fr
  'je j\' tu il elle on nous vous ils elles moi toi lui demain hier soir matin midi nuit aujourd\'hui maintenant tard tôt ' +
  'bientôt après avant plus moins regarde regarder cherche chercher vérifie vérifier vois voir sais trouve trouver rappelle ' +
  'attends attendre minute instant moment seconde désolé désolée pardon d\'accord bien super parfait cool salut bonjour ' +
  'bonsoir coucou peut-être sûr sûre où quand comment pourquoi lundi mardi mercredi jeudi vendredi samedi dimanche ' +
  // en
  'i you he she we they me it tomorrow yesterday tonight today now later soon morning evening night look check find ' +
  'sorry sure fine great thank thanks hi hello hey maybe where when how why monday tuesday wednesday thursday friday saturday sunday ' +
  // es, de, it, pt
  'yo tú él ella mañana ayer hoy noche tarde ahora luego gracias hola busco miro quizás ' +
  'ich du er sie wir morgen gestern heute abend jetzt später danke hallo vielleicht ' +
  'io lui lei domani ieri oggi stasera sera adesso dopo grazie ciao forse ' +
  'eu ele ela amanhã ontem hoje noite agora depois obrigado obrigada olá talvez ' +
  // sw, ar
  'mimi wewe yeye kesho jana leo usiku asubuhi sasa baadaye asante habari labda ' +
  'غدا أمس اليوم الليلة الآن لاحقا شكرا مرحبا ربما'
).split(/\s+/));
/** « Identifiant et mot de passe de la box ? », « Le mot de passe ? » : la question commence par le mot-clé (un article au plus). */
function questionSansVerbe(s: string): boolean {
  const m = RE_MOTS_UN.exec(s);
  if (!m) return false;
  return /^[\s¿¡]*(?:(?:et|and|y|und|e|na)\s+)?(?:(?:le|la|les|l['’]|ton|ta|tes|votre|vos|the|your|el|tu|su|das|dein|deine|ihr|il|lo|tuo|tua|o|a|seu|sua)\s*)?$/iu.test(s.slice(0, m.index));
}
const courant = (w: string) => COURANTS.has(w.toLowerCase().replace(/[!?.,;:…]+$/u, ''));
const REFUS = /^(?:non|no|nope|nan|ok|okay|oui|yes|si|sí|ja|nein|ndiyo|hapana|attends?|wait|plus tard|later|annule|cancel|stop|laisse tomber|pas maintenant|not now|je (?:ne )?sais pas|sais pas|j['’]sais pas|aucune id[ée]e|i don['’]?t know|dunno|idk|no s[ée]|wei(?:ß|ss) (?:ich )?nicht|non lo so|n[ãa]o sei|sijui|لا أعرف|لا)[\s.!…]*$/iu;

/** Odin vient de demander un secret : quelles familles (mot de passe, identifiant, code…) ? */
function demandeDOdin(q: unknown): Set<Famille> {
  const f = new Set<Famille>();
  if (typeof q !== 'string' || !q) return f;
  const s = q.slice(0, 4000);
  if (!DEMANDE.test(s) && !(QUESTION.test(s) && (MOT_QUESTION.test(s) || questionSansVerbe(s)))) return f;
  for (const m of s.matchAll(RE_MOTS)) f.add(motCleDe(m).f);
  return f;
}

/** La réponse à la question d'Odin : la réponse entière (un mot), ou le seul mot qui a l'air d'un secret, ou la paire demandée. */
function reponseALaQuestion(t: string, c: ContexteTri, out: Trouve[], dansMotCle: DansMotCle): void {
  const familles = demandeDOdin(c.questionOdin);
  if (!familles.size) return;
  const r = t.trim(), d = t.indexOf(r);
  if (!r || r.length > 256 || r.split('\n').length > 2 || /[?？؟]$/u.test(r) || REFUS.test(r) || r.includes('://')) return;
  if (familles.has('id') && familles.has('mdp')) {
    const p = /^(\S{1,128})(?:[ \t]{0,8}\/[ \t]{0,8}|[ \t]{0,8}\n[ \t]{0,8}|[ \t]{1,8})(\S{1,256})$/u.exec(r);
    const j = p ? r.lastIndexOf(p[2]) : -1;
    if (p && !estStop(p[1]) && !estStop(p[2]) && !dansMotCle(d, d + p[1].length, true) && !dansMotCle(d + j, d + j + p[2].length)) {
      out.push({ debut: d, fin: d + p[1].length, valeur: p[1], champ: 'identifiant', niveau: 3 },
        { debut: d + j, fin: d + j + p[2].length, valeur: p[2], champ: 'mot de passe', niveau: 3 });
      return;
    }
  }
  const f: Famille = familles.has('mdp') ? 'mdp' : familles.has('code') ? 'code' : familles.has('cle') ? 'cle' : 'id';
  const champ = f === 'id' ? 'identifiant' : f === 'code' ? 'code' : f === 'cle' ? 'clé' : 'mot de passe';
  // Un morceau de mot-clé, ou un mot-clé qui annonce la suite (« mot de passe Xk9… »), n'est pas la réponse ; « password » seul l'est.
  const motCle = (m: RegExpMatchArray) => { const i = d + (m.index ?? 0); return dansMotCle(i, i + nettoyerFin(m[0]).length); };
  if (!/\s/.test(r)) { if (!estStop(r) && !courant(r) && !dansMotCle(d, d + r.length)) out.push({ debut: d, fin: d + r.length, valeur: r, champ, niveau: 3 }); return; }
  // Plusieurs mots : le seul qui a l'air d'un secret (« c'est Xk9#pLm2 ») ; sinon toute la réponse, si aucun mot n'est
  // un mot courant de refus ou de phrase (« cheval agrafe pile lune »), au plus 6 mots.
  const mots = [...r.matchAll(/\S+/g)];
  const formes = mots.filter((m) => formeDeSecret(nettoyerFin(m[0])) && !motCle(m));
  if (formes.length === 1) { const v = nettoyerFin(formes[0][0]), i = d + (formes[0].index ?? 0); out.push({ debut: i, fin: i + v.length, valeur: v, champ, niveau: 3 }); return; }
  if (!formes.length && mots.length <= 6 && !mots.some((m) => motCle(m) || estStop(nettoyerFin(m[0])) || courant(m[0]) || /^(?:c['’]est|voici|voil[àa]|here|it['’]?s)$/i.test(m[0]))) out.push({ debut: d, fin: d + r.length, valeur: r, champ, niveau: 3 });
}

/** « admin / Xk9#pLm2 » après un sujet nommé (dans le message ou la conversation) : identifiant et mot de passe probables. */
function pairesApresSujet(t: string, c: ContexteTri, occ: readonly Sujet[], out: Trouve[], dansMotCle: DansMotCle): void {
  const re = /(?<![\p{L}\p{N}._@+\-/:\\])([\p{L}\p{N}._@+-]{2,64})[ \t]{0,8}\/[ \t]{0,8}([^\s/\\]{6,256})(?=\s|$)/gu;
  const m0 = masque(t.length, out);
  let contexte: string | undefined | null = null;
  for (const m of t.matchAll(re)) {
    const id = m[1], pw = nettoyerFin(m[2]), i = m.index ?? 0;
    const j = i + m[0].lastIndexOf(m[2]);
    if (!formeIdentifiant(id) || estStop(id) || !formeDeSecret(pw) || dansMotCle(j, j + pw.length)) continue;
    const sujet = sujetAvant(occ, m0, i) ?? (contexte === null ? (contexte = sujetDuContexte(c)) : contexte);
    if (!sujet) continue;
    // « box : login / X » : suivi de « / X », « login » est l'identifiant.
    out.push({ debut: i, fin: i + id.length, valeur: id, champ: 'identifiant', niveau: 3, nom: sujet },
      { debut: j, fin: j + pw.length, valeur: pw, champ: 'mot de passe', niveau: 3, nom: sujet });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Le tri

const LETTRE_OU_CHIFFRE = /[\p{L}\p{N}]/u;
/**
 * Remplace dans `s` chaque apparition de `v`, même collée à un autre mot (« x<valeur> » : aucun morceau ne reste) ;
 * `motEntier` (un identifiant comme « admin ») : seulement en mot entier, pour ne pas couper « administrateur ».
 */
function remplacerPartout(s: string, v: string, par: string, motEntier: boolean): string {
  let out = '', k = 0;
  const d = motEntier && LETTRE_OU_CHIFFRE.test(v[0]), f = motEntier && LETTRE_OU_CHIFFRE.test(v.at(-1)!);
  for (let i = s.indexOf(v); i >= 0; i = s.indexOf(v, i + 1)) {
    if (i < k) continue;
    if ((d && LETTRE_OU_CHIFFRE.test(s[i - 1] ?? '')) || (f && LETTRE_OU_CHIFFRE.test(s[i + v.length] ?? ''))) continue;
    out += s.slice(k, i) + par; k = i + v.length;
  }
  return out + s.slice(k);
}

/**
 * Reconnaît TOUS les secrets d'un message et rend le texte où chacun est remplacé par « [rangé au coffre : nom — champ] ».
 * Pur : n'écrit rien, ne journalise rien ; les valeurs ne sont que dans le résultat.
 */
export function trierSecrets(texte: string, contexte: ContexteTri = {}): ResultatTri {
  const t = typeof texte === 'string' ? texte : String(texte ?? '');
  if (t.length > LONGUEUR_MAX) return { texte: TEXTE_TROP_LONG, secrets: [], tropLong: true };
  const c: ContexteTri = contexte && typeof contexte === 'object' ? contexte : {};
  const trouves: Trouve[] = [];
  formesSures(t, trouves);
  valeursDuCoffre(t, c.coffre, trouves);
  const dansMotCle = motsClesDuTexte(t);
  annonces(t, trouves, dansMotCle);
  if (!trouves.length) reponseALaQuestion(t, c, trouves, dansMotCle);
  const occ = sujets(t);
  pairesApresSujet(t, c, occ, trouves, dansMotCle);

  // Les chevauchements : le niveau le plus sûr d'abord, puis le plus long.
  const pris = new Uint8Array(t.length + 1);
  const gardes: Trouve[] = [];
  for (const x of [...trouves].sort((a, b) => a.niveau - b.niveau || (b.fin - b.debut) - (a.fin - a.debut) || a.debut - b.debut)) {
    if (x.fin <= x.debut || !x.valeur || !libre(pris, x.debut, x.fin)) continue;
    pris.fill(1, x.debut, x.fin);
    gardes.push(x);
  }
  gardes.sort((a, b) => a.debut - b.debut);
  if (gardes.length > SECRETS_MAX) return { texte: TEXTE_TROP_DE_SECRETS, secrets: [], tropLong: true };

  // Les noms : la forme elle-même, puis le sujet de la ligne (le plus proche avant), puis un nom propre après « de »,
  // puis le premier sujet du message, puis la conversation ; sinon « Reçu le … ». Jamais une partie d'une valeur.
  const valeurs = [...new Set(gardes.map((g) => g.valeur))].filter((v) => v.length >= 3).slice(0, 256);
  const nomSain = (nom: string | undefined): nom is string => !!nom && !valeurs.some((v) => nom.includes(v) || (nom.length >= 4 && v.includes(nom)));
  const premier = occ.find((o) => libre(pris, o.i, o.fin))?.nom;
  let ctx: string | undefined | null = null;
  for (const g of gardes) {
    if (nomSain(g.nom)) continue;
    let nom = sujetAvant(occ, pris, g.debut, t.lastIndexOf('\n', g.debut - 1) + 1);
    if (!nomSain(nom) && g.qualif) nom = RE_PROPRE.exec(` ${g.qualif}`)?.[1];
    if (!nomSain(nom)) nom = premier;
    if (!nomSain(nom)) nom = ctx === null ? (ctx = sujetDuContexte(c)) : ctx;
    g.nom = nomSain(nom) ? nom : nomParDefaut(c);
  }

  // Le texte rendu : chaque plage remplacée ; puis toute autre apparition d'une valeur (4 caractères au moins, en mot
  // entier), hors des marques déjà posées.
  const morceaux: Array<{ texte: string; marque?: true }> = [];
  let k = 0;
  for (const g of gardes) {
    if (g.debut > k) morceaux.push({ texte: t.slice(k, g.debut) });
    morceaux.push({ texte: marque(g.nom!, g.champ), marque: true });
    k = g.fin;
  }
  if (k < t.length) morceaux.push({ texte: t.slice(k) });
  const parValeur = new Map<string, { par: string; motEntier: boolean }>();
  for (const g of [...gardes].sort((a, b) => b.valeur.length - a.valeur.length)) {
    if (g.valeur.length < 4) continue;
    const e = parValeur.get(g.valeur);
    if (!e) parValeur.set(g.valeur, { par: marque(g.nom!, g.champ), motEntier: g.champ === 'identifiant' });
    else if (g.champ !== 'identifiant') e.motEntier = false;
  }
  // Au plus SECRETS_MAX valeurs et SECRETS_MAX + 1 morceaux : borné.
  for (const p of morceaux) {
    if (p.marque) continue;
    for (const [v, { par, motEntier }] of parValeur) if (p.texte.length >= v.length && p.texte.includes(v)) p.texte = remplacerPartout(p.texte, v, par, motEntier);
  }

  // Une valeur rangée une fois (même nom, même champ) ; dans l'ordre du message.
  const vus = new Set<string>();
  const secrets: SecretTrouve[] = [];
  for (const g of gardes) {
    const cle = `${g.nom}\u0000${g.champ}\u0000${g.valeur}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    secrets.push({ nom: g.nom!, champ: g.champ, valeur: g.valeur, niveau: g.niveau, sur: g.niveau < 3 });
  }
  return { texte: morceaux.map((p) => p.texte).join(''), secrets };
}

// La liste publique BIP-39 (anglais, 2048 mots, dans l'ordre).
export const LISTE_BIP39: readonly string[] = [
  'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve',
  'acid acoustic acquire across act action actor actress actual adapt add addict address adjust admit adult',
  'advance advice aerobic affair afford afraid again age agent agree ahead aim air airport aisle alarm album',
  'alcohol alert alien all alley allow almost alone alpha already also alter always amateur amazing among amount',
  'amused analyst anchor ancient anger angle angry animal ankle announce annual another answer antenna antique',
  'anxiety any apart apology appear apple approve april arch arctic area arena argue arm armed armor army around',
  'arrange arrest arrive arrow art artefact artist artwork ask aspect assault asset assist assume asthma athlete',
  'atom attack attend attitude attract auction audit august aunt author auto autumn average avocado avoid awake',
  'aware away awesome awful awkward axis baby bachelor bacon badge bag balance balcony ball bamboo banana banner',
  'bar barely bargain barrel base basic basket battle beach bean beauty because become beef before begin behave',
  'behind believe below belt bench benefit best betray better between beyond bicycle bid bike bind biology bird',
  'birth bitter black blade blame blanket blast bleak bless blind blood blossom blouse blue blur blush board boat',
  'body boil bomb bone bonus book boost border boring borrow boss bottom bounce box boy bracket brain brand brass',
  'brave bread breeze brick bridge brief bright bring brisk broccoli broken bronze broom brother brown brush',
  'bubble buddy budget buffalo build bulb bulk bullet bundle bunker burden burger burst bus business busy butter',
  'buyer buzz cabbage cabin cable cactus cage cake call calm camera camp can canal cancel candy cannon canoe',
  'canvas canyon capable capital captain car carbon card cargo carpet carry cart case cash casino castle casual',
  'cat catalog catch category cattle caught cause caution cave ceiling celery cement census century cereal certain',
  'chair chalk champion change chaos chapter charge chase chat cheap check cheese chef cherry chest chicken chief',
  'child chimney choice choose chronic chuckle chunk churn cigar cinnamon circle citizen city civil claim clap',
  'clarify claw clay clean clerk clever click client cliff climb clinic clip clock clog close cloth cloud clown',
  'club clump cluster clutch coach coast coconut code coffee coil coin collect color column combine come comfort',
  'comic common company concert conduct confirm congress connect consider control convince cook cool copper copy',
  'coral core corn correct cost cotton couch country couple course cousin cover coyote crack cradle craft cram',
  'crane crash crater crawl crazy cream credit creek crew cricket crime crisp critic crop cross crouch crowd',
  'crucial cruel cruise crumble crunch crush cry crystal cube culture cup cupboard curious current curtain curve',
  'cushion custom cute cycle dad damage damp dance danger daring dash daughter dawn day deal debate debris decade',
  'december decide decline decorate decrease deer defense define defy degree delay deliver demand demise denial',
  'dentist deny depart depend deposit depth deputy derive describe desert design desk despair destroy detail',
  'detect develop device devote diagram dial diamond diary dice diesel diet differ digital dignity dilemma dinner',
  'dinosaur direct dirt disagree discover disease dish dismiss disorder display distance divert divide divorce',
  'dizzy doctor document dog doll dolphin domain donate donkey donor door dose double dove draft dragon drama',
  'drastic draw dream dress drift drill drink drip drive drop drum dry duck dumb dune during dust dutch duty dwarf',
  'dynamic eager eagle early earn earth easily east easy echo ecology economy edge edit educate effort egg eight',
  'either elbow elder electric elegant element elephant elevator elite else embark embody embrace emerge emotion',
  'employ empower empty enable enact end endless endorse enemy energy enforce engage engine enhance enjoy enlist',
  'enough enrich enroll ensure enter entire entry envelope episode equal equip era erase erode erosion error erupt',
  'escape essay essence estate eternal ethics evidence evil evoke evolve exact example excess exchange excite',
  'exclude excuse execute exercise exhaust exhibit exile exist exit exotic expand expect expire explain expose',
  'express extend extra eye eyebrow fabric face faculty fade faint faith fall false fame family famous fan fancy',
  'fantasy farm fashion fat fatal father fatigue fault favorite feature february federal fee feed feel female',
  'fence festival fetch fever few fiber fiction field figure file film filter final find fine finger finish fire',
  'firm first fiscal fish fit fitness fix flag flame flash flat flavor flee flight flip float flock floor flower',
  'fluid flush fly foam focus fog foil fold follow food foot force forest forget fork fortune forum forward fossil',
  'foster found fox fragile frame frequent fresh friend fringe frog front frost frown frozen fruit fuel fun funny',
  'furnace fury future gadget gain galaxy gallery game gap garage garbage garden garlic garment gas gasp gate',
  'gather gauge gaze general genius genre gentle genuine gesture ghost giant gift giggle ginger giraffe girl give',
  'glad glance glare glass glide glimpse globe gloom glory glove glow glue goat goddess gold good goose gorilla',
  'gospel gossip govern gown grab grace grain grant grape grass gravity great green grid grief grit grocery group',
  'grow grunt guard guess guide guilt guitar gun gym habit hair half hammer hamster hand happy harbor hard harsh',
  'harvest hat have hawk hazard head health heart heavy hedgehog height hello helmet help hen hero hidden high',
  'hill hint hip hire history hobby hockey hold hole holiday hollow home honey hood hope horn horror horse',
  'hospital host hotel hour hover hub huge human humble humor hundred hungry hunt hurdle hurry hurt husband hybrid',
  'ice icon idea identify idle ignore ill illegal illness image imitate immense immune impact impose improve',
  'impulse inch include income increase index indicate indoor industry infant inflict inform inhale inherit',
  'initial inject injury inmate inner innocent input inquiry insane insect inside inspire install intact interest',
  'into invest invite involve iron island isolate issue item ivory jacket jaguar jar jazz jealous jeans jelly',
  'jewel job join joke journey joy judge juice jump jungle junior junk just kangaroo keen keep ketchup key kick',
  'kid kidney kind kingdom kiss kit kitchen kite kitten kiwi knee knife knock know lab label labor ladder lady',
  'lake lamp language laptop large later latin laugh laundry lava law lawn lawsuit layer lazy leader leaf learn',
  'leave lecture left leg legal legend leisure lemon lend length lens leopard lesson letter level liar liberty',
  'library license life lift light like limb limit link lion liquid list little live lizard load loan lobster',
  'local lock logic lonely long loop lottery loud lounge love loyal lucky luggage lumber lunar lunch luxury lyrics',
  'machine mad magic magnet maid mail main major make mammal man manage mandate mango mansion manual maple marble',
  'march margin marine market marriage mask mass master match material math matrix matter maximum maze meadow mean',
  'measure meat mechanic medal media melody melt member memory mention menu mercy merge merit merry mesh message',
  'metal method middle midnight milk million mimic mind minimum minor minute miracle mirror misery miss mistake',
  'mix mixed mixture mobile model modify mom moment monitor monkey monster month moon moral more morning mosquito',
  'mother motion motor mountain mouse move movie much muffin mule multiply muscle museum mushroom music must',
  'mutual myself mystery myth naive name napkin narrow nasty nation nature near neck need negative neglect neither',
  'nephew nerve nest net network neutral never news next nice night noble noise nominee noodle normal north nose',
  'notable note nothing notice novel now nuclear number nurse nut oak obey object oblige obscure observe obtain',
  'obvious occur ocean october odor off offer office often oil okay old olive olympic omit once one onion online',
  'only open opera opinion oppose option orange orbit orchard order ordinary organ orient original orphan ostrich',
  'other outdoor outer output outside oval oven over own owner oxygen oyster ozone pact paddle page pair palace',
  'palm panda panel panic panther paper parade parent park parrot party pass patch path patient patrol pattern',
  'pause pave payment peace peanut pear peasant pelican pen penalty pencil people pepper perfect permit person pet',
  'phone photo phrase physical piano picnic picture piece pig pigeon pill pilot pink pioneer pipe pistol pitch',
  'pizza place planet plastic plate play please pledge pluck plug plunge poem poet point polar pole police pond',
  'pony pool popular portion position possible post potato pottery poverty powder power practice praise predict',
  'prefer prepare present pretty prevent price pride primary print priority prison private prize problem process',
  'produce profit program project promote proof property prosper protect proud provide public pudding pull pulp',
  'pulse pumpkin punch pupil puppy purchase purity purpose purse push put puzzle pyramid quality quantum quarter',
  'question quick quit quiz quote rabbit raccoon race rack radar radio rail rain raise rally ramp ranch random',
  'range rapid rare rate rather raven raw razor ready real reason rebel rebuild recall receive recipe record',
  'recycle reduce reflect reform refuse region regret regular reject relax release relief rely remain remember',
  'remind remove render renew rent reopen repair repeat replace report require rescue resemble resist resource',
  'response result retire retreat return reunion reveal review reward rhythm rib ribbon rice rich ride ridge rifle',
  'right rigid ring riot ripple risk ritual rival river road roast robot robust rocket romance roof rookie room',
  'rose rotate rough round route royal rubber rude rug rule run runway rural sad saddle sadness safe sail salad',
  'salmon salon salt salute same sample sand satisfy satoshi sauce sausage save say scale scan scare scatter scene',
  'scheme school science scissors scorpion scout scrap screen script scrub sea search season seat second secret',
  'section security seed seek segment select sell seminar senior sense sentence series service session settle',
  'setup seven shadow shaft shallow share shed shell sheriff shield shift shine ship shiver shock shoe shoot shop',
  'short shoulder shove shrimp shrug shuffle shy sibling sick side siege sight sign silent silk silly silver',
  'similar simple since sing siren sister situate six size skate sketch ski skill skin skirt skull slab slam sleep',
  'slender slice slide slight slim slogan slot slow slush small smart smile smoke smooth snack snake snap sniff',
  'snow soap soccer social sock soda soft solar soldier solid solution solve someone song soon sorry sort soul',
  'sound soup source south space spare spatial spawn speak special speed spell spend sphere spice spider spike',
  'spin spirit split spoil sponsor spoon sport spot spray spread spring spy square squeeze squirrel stable stadium',
  'staff stage stairs stamp stand start state stay steak steel stem step stereo stick still sting stock stomach',
  'stone stool story stove strategy street strike strong struggle student stuff stumble style subject submit',
  'subway success such sudden suffer sugar suggest suit summer sun sunny sunset super supply supreme sure surface',
  'surge surprise surround survey suspect sustain swallow swamp swap swarm swear sweet swift swim swing switch',
  'sword symbol symptom syrup system table tackle tag tail talent talk tank tape target task taste tattoo taxi',
  'teach team tell ten tenant tennis tent term test text thank that theme then theory there they thing this',
  'thought three thrive throw thumb thunder ticket tide tiger tilt timber time tiny tip tired tissue title toast',
  'tobacco today toddler toe together toilet token tomato tomorrow tone tongue tonight tool tooth top topic topple',
  'torch tornado tortoise toss total tourist toward tower town toy track trade traffic tragic train transfer trap',
  'trash travel tray treat tree trend trial tribe trick trigger trim trip trophy trouble truck true truly trumpet',
  'trust truth try tube tuition tumble tuna tunnel turkey turn turtle twelve twenty twice twin twist two type',
  'typical ugly umbrella unable unaware uncle uncover under undo unfair unfold unhappy uniform unique unit',
  'universe unknown unlock until unusual unveil update upgrade uphold upon upper upset urban urge usage use used',
  'useful useless usual utility vacant vacuum vague valid valley valve van vanish vapor various vast vault vehicle',
  'velvet vendor venture venue verb verify version very vessel veteran viable vibrant vicious victory video view',
  'village vintage violin virtual virus visa visit visual vital vivid vocal voice void volcano volume vote voyage',
  'wage wagon wait walk wall walnut want warfare warm warrior wash wasp waste water wave way wealth weapon wear',
  'weasel weather web wedding weekend weird welcome west wet whale what wheat wheel when where whip whisper wide',
  'width wife wild will win window wine wing wink winner winter wire wisdom wise wish witness wolf woman wonder',
  'wood wool word work world worry worth wrap wreck wrestle wrist write wrong yard year yellow you young youth',
  'zebra zero zone zoo',
].join(' ').split(' ');
