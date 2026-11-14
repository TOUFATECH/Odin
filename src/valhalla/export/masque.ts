// Export et partage des pages d'applis · la passe de masquage.
// Les pages d'Odin n'affichent déjà pas les mots de passe, les clés ni les jetons. Cette passe est un filet de
// sécurité en plus, appliquée à tout ce qui sort d'Odin dans un fichier exporté ou une copie partagée :
//   - les secrets qu'Odin connaît (son masqueur : coffre, variables d'environnement, mots de passe des machines) ;
//   - les formes connues de secrets (clés d'API, clés privées, jetons d'accès, « mot de passe : … », options d'une
//     commande, variables NOM_SECRET=…, identifiants dans une adresse, adresses secrètes d'Odin lui-même) ;
//   - la valeur rangée sous un intitulé sensible (colonne « Mot de passe », ligne « Jeton »…).
// Elle ne promet pas de tout attraper : un secret écrit en clair dans une phrase ordinaire peut lui échapper.
// Tout est pur (un texte entre, un texte sort).

/** Ce qui remplace une valeur masquée. */
export const MASQUE = '•••';

/** Un intitulé qui annonce un secret : la valeur d'à côté est masquée, sauf si elle dit seulement un état (« oui », « absent »…). */
const STRICT = /mots? de passe|\bmdp\b|passwords?|passphrase|\bsecrets?\b|\bjetons?\b|\btokens?\b|\bpsk\b|\bpin\b|cl[ée]s? (?:priv[ée]e|secr[èe]te|d['’]api|api|wi-?fi|wpa|de s[ée]curit[ée])|api[ _-]?key/i;
/** Un intitulé qui peut annoncer un secret (« Clé ») : seules les valeurs qui ressemblent à un secret sont masquées. */
const DOUX = /^cl[ée]s?$|cookie|authorization/i;
/** Une valeur qui dit un état, pas un secret. */
const ETAT = /^(?:|—|–|-|\?|oui|non|aucune?|absente?|pr[ée]sente?|vide|avec|sans|n\/a|ok|prot[ée]g[ée]e?|gard[ée]e?|masqu[ée]e?|cach[ée]e?|chiffr[ée]e?|d[ée]finie?|non d[ée]finie?|enregistr[ée]e?|rang[ée]e?(?: dans le coffre)?|dans le coffre|requise?|obligatoire|facultati(?:f|ve)|acti(?:f|ve)|inacti(?:f|ve)|activ[ée]e?|d[ée]sactiv[ée]e?|coup[ée]e?|expir[ée]e?|valide|invalide|faible|moyen(?:ne)?|forte?|bon(?:ne)?|jamais|toujours|inchang[ée]e?|chang[ée]e?|g[ée]n[ée]r[ée]e?|manquante?|inconnue?|d['’]origine|par d[ée]faut|[àa] r[ée]gler|[àa] d[ée]finir|[àa] changer)$/i;
/** Un nombre, une date, une heure, un pourcentage : pas un secret (sauf sous « PIN »). */
const CHIFFRES = /^[\d\s./:%,+-]+\s?(?:[kKMGT]i?[oB]?|ms|s|min|h|j|€)?$/;
const CLE_PRODUIT = /^[A-Z0-9]{4,6}(?:-[A-Z0-9]{4,6}){2,}$/;

/** Cette valeur ressemble-t-elle à un secret ? (6 caractères au moins, sans espace, et un mélange de genres : lettres, majuscules, chiffres, signes.) */
export function ressembleASecret(v: string, o: { chiffres?: boolean } = {}): boolean {
  if (v.length < 6 || /\s/.test(v) || v.includes(MASQUE)) return o.chiffres === true && /^\d{4,}$/.test(v);
  if (CHIFFRES.test(v)) return o.chiffres === true && /^\d{4,}$/.test(v);
  if (CLE_PRODUIT.test(v)) return true;
  // Une majuscule en tête de mot ne compte pas (« Bonjour » n'est pas un secret).
  const x = v.replace(/^[A-ZÀ-Ý]/, (c) => c.toLowerCase());
  const genres = Number(/[a-zà-ÿ]/.test(x)) + Number(/[A-ZÀ-Ý]/.test(x)) + Number(/\d/.test(x)) + Number(/[^A-Za-zÀ-ÿ0-9\-'’.]/.test(x));
  return genres >= 2;
}

export interface Masqueur {
  /** Masque les secrets d'un texte libre (phrase, ligne de journal, case d'un tableau). */
  texte(t: string): string;
  /** Masque une valeur rangée sous un intitulé (colonne, ligne « clé · valeur », titre) : plus sévère si l'intitulé annonce un secret. */
  sous(intitule: string, valeur: string): string;
  /** Combien de valeurs ont été masquées jusqu'ici. */
  n(): number;
}

/**
 * Prépare la passe de masquage. `connus` : le masqueur d'Odin (il remplace par « [SECRET] » les secrets qu'il connaît
 * et les clés d'API reconnaissables) ; sans lui, seules les formes connues sont masquées.
 */
export function creerMasqueur(connus?: (t: string) => string): Masqueur {
  let n = 0;
  const m = () => { n++; return MASQUE; };
  const texte = (brut: string): string => {
    let t = String(brut ?? '');
    if (!t) return t;
    if (connus) { const r = connus(t); if (r !== t) t = r.replace(/\[SECRET\]/g, m); }
    return t
      // une clé privée entière
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, m)
      // identifiants dans une adresse : rtsp://admin:motdepasse@camera → rtsp://admin:•••@camera
      .replace(/\b([a-z][a-z0-9+.-]{1,15}:\/\/[^\s/:@"'<>]{1,80}):([^\s/@"'<>]{1,200})@/gi, (_x, a: string) => `${a}:${m()}@`)
      // les adresses secrètes d'Odin (réservation, signe de vie, page d'état, webhook, formulaire, partage)
      .replace(/(https?:\/\/[^\s/"'<>]+)\/(r|v|h|f|p|etat|partage)\/[\w-]{12,}/g, (_x, a: string, b: string) => `${a}/${b}/${m()}`)
      .replace(/(^|[\s"'«(=:,])\/(r|v|h|f|p|etat|partage)\/[\w-]{12,}/g, (_x, a: string, b: string) => `${a}/${b}/${m()}`)
      // un secret passé dans une adresse : ?token=…, &key=…
      .replace(/([?&](?:token|jeton|key|cle|apikey|api_key|access_token|refresh_token|id_token|secret|password|passwd|pwd|pass|motdepasse|mdp|sig|signature|auth|code)=)[^&\s#"'<>]+/gi, (_x, a: string) => `${a}${m()}`)
      // un secret passé à une commande : --password …, --token=…, mysql -p…, sshpass -p …
      .replace(/((?:^|\s)--?(?:password|passwd|pass|pwd|token|secret|api[-_]?key|apikey|auth[-_]?token|access[-_]?token|psk|private[-_]?key|cle|jeton|mot[-_]?de[-_]?passe)(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi, (_x, a: string) => `${a}${m()}`)
      .replace(/(\b(?:mysql|mysqldump|mysqladmin|mariadb|mariadb-dump|mycli)\b[^\n]*?\s-p)([^\s-]\S*)/g, (_x, a: string) => `${a}${m()}`)
      .replace(/(\bsshpass\s+-p\s*)(\S+)/g, (_x, a: string) => `${a}${m()}`)
      // une variable d'environnement : MQTT_PASSWORD=…, GITHUB_TOKEN=…
      .replace(/\b([A-Za-z0-9_]*(?:PASSWORD|PASSWD|PWD|TOKEN|SECRET|API_?KEY|APIKEY|PRIVATE_?KEY|ACCESS_?KEY|PSK)[A-Za-z0-9_]*\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s"',;]+)/g, (_x, a: string) => `${a}${m()}`)
      // « mot de passe : … », « jeton = … », « PrivateKey = … » quand la suite ressemble à un secret
      .replace(/((?:mots? de passe|\bmdp|passwords?|passphrase|secret|jetons?|tokens?|cl[ée]s? (?:priv[ée]e|secr[èe]te|d['’]api|api|wi-?fi|wpa|de s[ée]curit[ée])|api[ _-]?key|\bpsk|code pin|\bpin|privatekey|presharedkey|preshared key)\b[^\n:=]{0,30}?\s*[:=]\s*["'«“]?\s*)([^\s"'»”,;<>]{4,})/gi, (x, a: string, v: string) => (ressembleASecret(v, { chiffres: /pin/i.test(a) }) ? `${a}${m()}` : x))
      // un jeton d'accès (JWT), une authentification « Basic »
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, m)
      .replace(/(\bBasic\s+)([A-Za-z0-9+/=]{12,})/g, (x, a: string, v: string) => (/[0-9=+/]|[a-z][A-Z]/.test(v) ? `${a}${m()}` : x))
      // le mot de passe d'un QR code de Wi-Fi : WIFI:T:WPA;S:Maison;P:…;;
      .replace(/(WIFI:(?:[^;\s]*;)*?P:)(?:\\.|[^;\s])+/g, (_x, a: string) => `${a}${m()}`);
  };
  const sous = (intitule: string, valeur: string): string => {
    let v = String(valeur ?? '');
    if (!v) return v;
    const cle = String(intitule ?? ''), strict = STRICT.test(cle), doux = !strict && DOUX.test(cle), pin = /\bpin\b/i.test(cle);
    if (strict || doux) {
      const net = v.trim();
      if (strict && !/\s/.test(net) && !ETAT.test(net) && (pin || !CHIFFRES.test(net))) return m();
      // Sous « Clé », un chemin ou un nom reste lisible : seule une clé de produit ou une longue suite tirée au hasard est masquée.
      const secret = (mot: string) => (strict ? ressembleASecret(mot, { chiffres: pin }) : CLE_PRODUIT.test(mot) || (mot.length >= 20 && /^[A-Za-z0-9+/_=-]+$/.test(mot) && /\d/.test(mot) && /[A-Za-z]/.test(mot)));
      if (!ETAT.test(net)) v = v.replace(/[^\s"'«»“”,;<>()]+/g, (mot) => (secret(mot) ? m() : mot));
    }
    return texte(v);
  };
  return { texte, sous, n: () => n };
}
