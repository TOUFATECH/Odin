// La clé d'accès (clé d'API, « Authorization: Bearer … ») : ce qu'elle peut encore faire.
//
// Décision du propriétaire (24/11) : « Lire et parler seulement ». La clé lit l'état et parle à Odin. Tous les gestes
// qui écrivent sont réservés à la session du propriétaire, dans son navigateur. Une validation ne vient jamais de la clé.
//
// Tout se décide ICI, à un seul endroit : le serveur (server.ts) pose la question, cette page répond. La règle est
// « fermé sauf ce qui est écrit ici » : une route nouvelle qui écrit est donc fermée à la clé sans rien avoir à faire.
//
// Trois moments, la même fonction :
//   1. avant de lire le corps  : la méthode et le chemin suffisent souvent (tout POST hors de la courte liste : refus ;
//                                 toute autre méthode que GET et POST : refus, HEAD et OPTIONS aussi) ;
//   2. le corps lu             : le geste de /api/action, l'action d'une appli, le texte d'un message ;
//   3. la réponse d'une appli  : une lecture qui rend un secret (QR code, configuration, fichier) ne part pas.
//
// Tant qu'Odin n'a pas de compte, il n'y a pas de session du propriétaire : la clé sert à l'installer, rien n'est fermé
// (c'est server.ts qui le vérifie avant d'appeler cette page).

/** La phrase du refus (403), la même partout. */
export const REFUS_CLE = 'Ce geste demande ta session : ouvre Odin et connecte-toi.';
/** La phrase du refus quand la clé essaie de répondre à une demande de validation, ou d'envoyer une commande. */
export const REFUS_VALIDATION = 'Une validation ou une commande ne vient que de ta session : ouvre Odin et réponds-y.';
/** La phrase du refus quand le texte de la clé porte une très longue suite d'espaces (voir `TROP_D_ESPACES`). */
export const REFUS_ESPACES = 'Ce message porte une trop longue suite d\'espaces : renvoie-le sans.';

/** Un refus : ce qui est noté dans le journal du serveur (jamais le contenu de la demande), et la phrase rendue. */
export interface RefusCle { quoi: string; phrase: string }

/** Ce que le serveur sait d'une action d'appli (la même forme que dans src/valhalla/types.ts, en plus court). */
export interface ActionVue { read?: boolean; proprietaireSeul?: boolean | ((input: Record<string, unknown>, ctx?: never) => boolean); grave?: (input: Record<string, unknown>, ctx?: never) => string | undefined }
/** Les applis, vues d'ici : retrouver une action et le contexte de son appli. */
export interface ApplisVues { action(module: string, action: string): { m: { id: string }; a: ActionVue } | undefined; ctx(id: string): unknown }

/** Ce que le serveur donne au moment de la question (tout est facultatif : voir les trois moments plus haut). */
export interface DemandeCle { corps?: Record<string, unknown>; reponse?: unknown; applis?: ApplisVues }

// ---------------------------------------------------------------- les listes

/**
 * Routes où la clé d'accès ne donne aucun droit une fois le compte créé : elles gardent leur réponse à elles.
 *  - l'écran de la maison et OwnTracks ont leur propre clé (tablette, identifiants) ;
 *  - l'installation et la connexion (appairage, première connexion, création du compte, connexion, déconnexion,
 *    connexion par QR code) sont ouvertes à tous et ne regardent que le compte, le mot de passe ou la session.
 */
const A_PART = new Set(['/api/owntracks', '/api/pair', '/api/pair/status', '/api/setup/start', '/api/setup/status', '/api/account/create', '/api/account/login', '/api/account/logout']);
const ROUTES_A_PART = (chemin: string) => A_PART.has(chemin) || chemin.startsWith('/api/maison/') || chemin.startsWith('/api/connexion-qr/');

/** Lectures qui rendent un secret, un fichier ou toute une archive : pas pour la clé. */
const LECTURES_FERMEES: Array<(chemin: string) => boolean> = [
  (c) => c.startsWith('/api/terminal/'), // les terminaux et l'aperçu des projets
  (c) => c.startsWith('/api/valhalla/export'), // l'export de la page d'une appli (Word, PDF…), la connexion Google
  (c) => c === '/api/valhalla/fichier', // un fichier remis par une appli
  (c) => c === '/api/valhalla/partage' || c === '/api/valhalla/partages', // les liens de partage (un lien est un secret)
  (c) => c === '/api/conversations/export', // toutes les conversations
  (c) => c === '/api/runes/export', // une base entière
  (c) => c === '/api/memoire/export', // toute la mémoire
  (c) => c === '/api/rodd/archive/son', // la copie sonore d'une conversation
  (c) => c === '/api/draupnir/flow', // le détail d'une automatisation : il porte le chemin secret de son webhook (qui l'a la lance)
  (c) => c === '/api/ran/packet', // le contenu brut d'un paquet du réseau (un mot de passe en clair peut y passer)
  (c) => c === '/api/ran/live', // l'écoute en direct : elle LANCE une capture du réseau (un geste, pas une lecture)
];

/** POST permis sans regarder le corps : rien n'y est écrit (un texte préparé, un son rendu ou transcrit). */
const POST_SANS_ECRITURE = new Set(['/api/voice/texte', '/api/voice/speak', '/api/voice/transcribe']);
/** POST dont le corps décide. `/mcp` : le connecteur garde son fonctionnement (hors de ce lot), voir `refusDeLaCle`. */
const POST_SELON_LE_CORPS = new Set(['/api/ask', '/api/message', '/api/action', '/api/valhalla/act']);

/**
 * Gestes de /api/action que la clé garde : des lectures de l'état, qui ne changent rien et ne rendent aucun secret.
 * Tout autre geste (connu ou nouveau) est fermé. « access_links » n'y est pas : il rend les liens d'accès et la clé.
 */
export const GESTES_LUS: ReadonlySet<string> = new Set([
  'device_page', // la fiche d'un appareil (le mot de passe n'y est jamais : seulement « il y en a un »)
  'audit_list', // le journal des décisions
  'skill_body', 'script_body', // le texte d'une compétence, d'un script
  'conv_search', // chercher dans les conversations
  'mission_trace', // ce qu'une mission a fait (déjà masqué)
  'explain', // « pourquoi cette réponse »
  'push_key', // la clé PUBLIQUE des notifications
  'codex_device_status', // où en est une connexion en cours
]);

/**
 * Actions d'applis (/api/valhalla/act) que la clé garde : écrites ici une à une, après relecture. La marque « read: true »
 * d'une action ne suffit pas : elle dit « ne change pas l'état de l'appli », pas « ne sort rien et n'écrit rien »
 * (« Tester le débit » télécharge 25 Mo et écrit un fichier ; d'autres lisent un fichier ou exportent). Une action
 * d'ici doit aussi être une lecture, sans confirmation ni « propriétaire seul », et sa réponse ne part pas si elle
 * est secrète (voir `refusDeLaCle`).
 */
export const ACTIONS_LUES: ReadonlySet<string> = new Set([
  'svalinn.qr_invites', // le QR code du Wi-Fi invités (avec un mot de passe, la réponse est secrète : elle ne part pas)
]);

// ---------------------------------------------------------------- parler sans valider

/**
 * Les formes de réponse que la passerelle reconnaît (src/bifrost/gateway.ts), recopiées telles qu'elles y sont écrites :
 * le filtre est construit à partir d'elles, et un essai vérifie que la passerelle les porte toujours (si elle apprend
 * une nouvelle forme ou une nouvelle langue, l'essai tombe et cette liste suit). Aucune autre phrase ne tranche une
 * validation, dans aucune langue : la passerelle ne connaît que celles-ci.
 */
export const FORMES_PASSERELLE: Readonly<Record<string, string>> = {
  'réponse avec identifiant': String.raw`/^\/(yes|no|oui|non|always|toujours)\s+(\S+)/i`,
  'réponse courte': String.raw`/^\/?(yes|no|oui|non|nan|ok|okay|ouais|vas[- ]y|d'accord|daccord|go|always|toujours)[\s.!]*$/i`,
  'oui, supprime': String.raw`/^(oui|ok|d'accord|vas-y|confirme)\b.{0,30}$|^oui,? supprime/i`,
};
const FORMES = Object.values(FORMES_PASSERELLE).map((f) => new RegExp(f.slice(1, f.lastIndexOf('/')), f.slice(f.lastIndexOf('/') + 1)));
/** Les caractères qui ne se voient pas (largeur nulle, sens d'écriture, marque d'ordre des octets, tiret conditionnel). */
const INVISIBLES = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;

/**
 * Le texte envoyé par la clé est-il une réponse à une validation, ou une commande ? Les formes de la passerelle
 * (`FORMES_PASSERELLE`) : « /yes 12 », « oui », « non », « ok », « vas-y », « toujours » tout court, « oui, supprime ».
 * Une commande « /… » est un geste : elle passe par la session, elle aussi.
 * `coupe` : le serveur ne remet à la passerelle que le début du texte (4 000 caractères au raccourci, 20 000 à la page) ;
 * le texte est donc jugé en entier ET tel qu'il arrivera, coupé — « oui », des espaces, puis une longue phrase que la
 * coupe fait disparaître, c'est « oui ». Le filtre est plus large que la passerelle, jamais plus étroit : écritures de
 * compatibilité ramenées à la lettre simple, caractères invisibles retirés, apostrophes courbes redressées.
 */
export function estValidationOuCommande(texte: string, coupe = Number.POSITIVE_INFINITY): boolean {
  const vues = new Set([texte, texte.slice(0, coupe)]);
  for (const brut of [...vues]) vues.add(brut.normalize('NFKC').replace(INVISIBLES, '').replace(/[‘’ʼ`´]/g, '\''));
  for (const vue of vues) { const t = vue.trim(); if (t.startsWith('/') || FORMES.some((f) => f.test(t))) return true; }
  return false;
}

/**
 * Une très longue suite d'espaces dans le texte de la clé : refusée. Mesuré à la relecture du 24/11 : le tri des secrets
 * d'un message reçu (noyau) met un temps qui grandit comme le cube de la longueur d'une suite d'espaces — 2 000 espaces
 * bloquent Odin 16 secondes, 4 000 plus de deux minutes, pendant lesquelles il ne répond à personne. La vraie
 * correction est dans le noyau (hors de ce lot) ; d'ici là, une demande qui porte la clé ne peut pas s'en servir.
 * 40 espaces à la suite au plus : au-dessous, le tri reste sous le dixième de seconde pour un message entier.
 */
const TROP_D_ESPACES = /\s{41,}/;

// ---------------------------------------------------------------- les secrets dans une réponse

/** La réponse d'une appli porte-t-elle un secret (QR code ou configuration marqués, clé privée, fichier à retirer) ? */
export function reponseSecrete(r: unknown): boolean {
  if (!r || typeof r !== 'object') return false;
  const x = r as { data?: unknown; fichiers?: unknown }, d = (x.data && typeof x.data === 'object' ? x.data : {}) as Record<string, unknown>;
  if (Array.isArray(x.fichiers) && x.fichiers.length) return true;
  return d.secret === true || d.file === true || /^\s*(PrivateKey|PresharedKey)\s*=/m.test(String(d.conf ?? ''));
}

// ---------------------------------------------------------------- la décision

/**
 * La clé d'accès peut-elle faire cette demande ? Rend `undefined` si oui (ou si le corps manque encore pour le dire),
 * sinon le refus. Le serveur n'appelle cette fonction que pour une demande qui porte la clé, une fois le compte créé.
 */
export function refusDeLaCle(methode: string, chemin: string, d: DemandeCle = {}): RefusCle | undefined {
  const m = methode.toUpperCase(), non = (quoi: string, phrase = REFUS_CLE): RefusCle => ({ quoi: `${m} ${chemin}${quoi ? ` (${quoi})` : ''}`, phrase });
  if (ROUTES_A_PART(chemin)) return undefined;
  // 3. La réponse d'une appli, juste avant qu'elle parte.
  if (d.reponse !== undefined) return reponseSecrete(d.reponse) ? non('réponse secrète') : undefined;
  // Lire : permis, sauf ce qui rend un secret, un fichier ou une archive.
  if (m === 'GET') return LECTURES_FERMEES.some((f) => f(chemin)) ? non('lecture fermée') : undefined;
  // PUT, DELETE, PATCH… : toujours une écriture. HEAD et OPTIONS aussi sont refusées : plusieurs routes prennent
  // « tout ce qui n'est pas GET » pour une écriture (elles lisent le corps et écrivent), et aucun programme n'en a besoin
  // avec la clé (la question préalable d'un navigateur ne porte jamais l'en-tête de la clé).
  if (m !== 'POST') return non('');
  // Le connecteur MCP : inchangé dans ce lot (question ouverte, posée au propriétaire).
  if (chemin === '/mcp') return undefined;
  if (POST_SANS_ECRITURE.has(chemin)) return undefined;
  if (!POST_SELON_LE_CORPS.has(chemin)) return non('');
  // 1. Le corps n'est pas encore lu : la réponse viendra au deuxième appel.
  const b = d.corps; if (!b) return undefined;
  // 2. Le corps est lu.
  if ((chemin === '/api/ask' || chemin === '/api/message') && TROP_D_ESPACES.test(String(b.text ?? ''))) return non('trop d\'espaces à la suite', REFUS_ESPACES);
  // Le serveur coupe le texte avant de le remettre à la passerelle : 4 000 caractères au raccourci, 20 000 à la page.
  if (chemin === '/api/ask' || chemin === '/api/message') return estValidationOuCommande(String(b.text ?? ''), chemin === '/api/ask' ? 4000 : 20_000) ? non('validation ou commande', REFUS_VALIDATION) : undefined;
  if (chemin === '/api/action') { const k = typeof b.kind === 'string' ? b.kind : ''; return GESTES_LUS.has(k) ? undefined : non(k.replace(/[^\w-]/g, '').slice(0, 40) || 'geste inconnu'); }
  // /api/valhalla/act : seulement une action écrite dans `ACTIONS_LUES`, qui est une lecture (« read: true »), ni
  // « propriétaire seul », ni à confirmer.
  const mod = String(b.module ?? ''), act = String(b.action ?? ''), nom = `${mod}.${act}`.replace(/[^\w.-]/g, '').slice(0, 80);
  if (b.confirm === true) return non(`${nom}, confirmation`); // une confirmation est une validation : jamais par la clé
  if (!ACTIONS_LUES.has(`${mod}.${act}`)) return non(nom);
  const f = d.applis?.action(mod, act); if (!f) return non(`${nom}, action inconnue`);
  if (f.a.read !== true) return non(nom);
  const entree = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>;
  let ctx: unknown; try { ctx = d.applis!.ctx(f.m.id); } catch { return non(nom); }
  try {
    if (typeof f.a.proprietaireSeul === 'function' ? f.a.proprietaireSeul(entree, ctx as never) : f.a.proprietaireSeul === true) return non(`${nom}, propriétaire seul`);
    if (f.a.grave?.(entree, ctx as never)) return non(`${nom}, à confirmer`);
  } catch { return non(nom); }
  return undefined;
}
