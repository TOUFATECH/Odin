// Le fil d'une personne : toutes ses conversations assemblées en une seule suite, dans l'ordre des dates, le titre de
// chacune en séparateur, lue par pages. Assemblage PUR : rien n'est déplacé, réécrit ni effacé ; on lit tous les
// messages des sessions (pas l'historique actif d'après la dernière compaction), donc la compaction ne cache rien ici.
// Seul le masque (en bas) écrit quelque chose : une marque, jamais un message.
//
// Qui lit quoi (le serveur décide d'après le compte connecté, jamais d'après la page) :
//   - le propriétaire : ses conversations de la Discussion, « web:principal » et les anciennes « web:c-… » ; ni celle
//     d'un membre, ni un sous-agent ;
//     les portes des écrans techniques (maison, voix, Vénus, Cerveau, Réglages) : décision du propriétaire du 19/11
//     (« Dans le fil, étiquetés ») ; chacun de leurs messages porte son origine (la page écrit « depuis l'écran de la
//     maison », « depuis la voix »…) et, comme le téléphone, ne coupe pas la conversation (pas de séparateur) ; ils
//     restent des sessions à part : ils n'entrent pas dans le contexte de la conversation ;
//     et « web:raccourci » (les raccourcis du téléphone, POST /api/ask avec sa clé d'API) : décision du propriétaire
//     du 19/11 (« Oui, avec une étiquette ») ; chacun de ses messages porte l'origine « telephone » (la page écrit
//     « depuis le téléphone ») et ne coupe pas la conversation (pas de séparateur) ;
//     ses messageries seulement si l'appelant les passe (`messageries`, prévu pour plus tard, pas encore utilisé) ;
//   - un membre : sa conversation « web:membre-<identifiant> », rien d'autre.
//
// Pages : du plus récent au plus ancien. Le curseur `avant` (« <date>-<numéro> ») désigne le plus ancien message de la
// page lue ; la page suivante prend les messages strictement plus anciens. Un message arrivé pendant la lecture est plus
// récent que tout curseur déjà donné : il n'apparaît pas dans les pages plus anciennes (ni doublon ni trou).

export type QuiFil = { proprio: true } | { login: string };
/** `marquee` : Odin y a lu un contenu non fiable (web, mails…) ; la page met ⚠ sur son séparateur. */
export interface SessionFil { id: string; channel: string; title: string; marquee?: boolean }
export interface MessageBrut { id: number; session_id: string; role: string; content: string; created_at: number }
/** Un message du fil : du texte, jamais du HTML (c'est à la page de l'afficher comme du texte). */
export interface Bulle { type: 'message'; id: number; session: string; role: 'user' | 'assistant'; texte: string; date: number; origine?: Origine }
/** Le début d'une conversation (ou sa reprise après une autre) : son titre et la date de son premier message. */
export interface Separateur { type: 'separateur'; session: string; titre: string; debut: number; marquee?: true }
export type ElementFil = Bulle | Separateur;

export const SESSION_PRINCIPALE = 'web:principal';
/** Une conversation ouverte par « Nouvelle » dans la Discussion (« c- » + la date en base 36, 40 caractères au plus). */
const ANCIENNE = /^web:c-[a-z0-9]{1,38}$/;
/** Les raccourcis du téléphone (Siri, Android : POST /api/ask avec la clé d'API du propriétaire). */
const RACCOURCI = 'web:raccourci';
/** D'où vient un message qui n'est pas dit dans la Discussion elle-même. */
export type Origine = 'telephone' | 'maison' | 'voix' | 'venus' | 'cerveau' | 'reglages';
/** Les portes des écrans techniques et l'origine écrite sur chacun de leurs messages dans le fil du propriétaire. */
const ECRANS: Readonly<Record<string, Origine>> = { 'web:maison': 'maison', 'web:voix': 'voix', 'web:venus': 'venus', 'web:cerveau': 'cerveau', 'web:reglages': 'reglages' };
const origineDe = (session: string): Origine | undefined => (session === RACCOURCI ? 'telephone' : Object.hasOwn(ECRANS, session) ? ECRANS[session] : undefined);
export const PAGE_DEFAUT = 100, PAGE_MAX = 200;

/**
 * La session d'un membre, telle que la barre des applis la nomme. Un identifiant que ce nom raccourcirait ou changerait
 * (point, trop long) ne reçoit rien : deux personnes ne doivent jamais tomber sur la même session.
 */
export function sessionDuMembre(login: string): string | undefined {
  return /^[\w-]{1,33}$/.test(login) ? `web:membre-${login}` : undefined;
}

/**
 * Les sessions qui forment le fil de cette personne, parmi celles qui existent. `ecrans` : avec les portes des écrans
 * techniques du propriétaire (le fil affiché les veut ; la fusion des anciennes conversations, non : ce ne sont pas des
 * conversations à fondre).
 */
export function sessionsDuFil(qui: QuiFil, sessions: SessionFil[], o: { messageries?: string[]; ecrans?: boolean } = {}): string[] {
  const existe = new Map(sessions.map((s) => [s.id, s]));
  if ('proprio' in qui) {
    const web = sessions.filter((s) => s.id === SESSION_PRINCIPALE || ANCIENNE.test(s.id) || s.id === RACCOURCI || (o.ecrans && origineDe(s.id))).map((s) => s.id);
    // Les messageries : seulement des sessions qui existent et qui ne sont pas des sessions de l'interface.
    const autres = (o.messageries ?? []).filter((id) => { const s = existe.get(id); return Boolean(s && s.channel !== 'web' && !id.startsWith('web:')); });
    return [...new Set([...web, ...autres])];
  }
  const sienne = sessionDuMembre(qui.login);
  return sienne && existe.has(sienne) ? [sienne] : [];
}

/** Toutes les bulles de ces sessions, dans l'ordre des dates (puis des numéros) ; ni outils ni messages vides. */
export function assembler(sessions: SessionFil[], messagesDe: (id: string) => MessageBrut[]): Array<Bulle & { titre: string; marquee?: boolean }> {
  const out: Array<Bulle & { titre: string; marquee?: boolean }> = [];
  for (const s of sessions) {
    const origine = origineDe(s.id);
    for (const m of messagesDe(s.id)) {
      if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content) continue;
      out.push({ type: 'message', id: m.id, session: s.id, role: m.role, texte: m.content, date: m.created_at, titre: s.title, ...(s.marquee ? { marquee: true } : {}), ...(origine ? { origine } : {}) });
    }
  }
  return out.sort((a, b) => a.date - b.date || a.id - b.id);
}

const curseurDe = (b: { date: number; id: number }) => `${b.date}-${b.id}`;
function lireCurseur(c: string): { date: number; id: number } {
  const m = /^(\d{1,16})-(\d{1,16})$/.exec(c);
  if (!m) throw new Error('curseur illisible');
  return { date: Number(m[1]), id: Number(m[2]) };
}

/**
 * Une page du fil : les `n` messages les plus récents strictement avant `avant` (ou les plus récents de tous), dans
 * l'ordre des dates, chacun précédé de son séparateur quand il ouvre une conversation (ou y revient après une autre).
 * Un message du téléphone ou d'un écran technique n'a pas de séparateur et ne compte pas comme un changement de conversation.
 * Le séparateur d'une conversation marquée (contenu non fiable lu) porte `marquee`.
 * `suite` : le curseur de la page plus ancienne, ou null quand il n'y a plus rien au-dessus.
 */
export function lirePage(bulles: Array<Bulle & { titre: string; marquee?: boolean }>, o: { n?: number; avant?: string }): { elements: ElementFil[]; suite: string | null } {
  const n = Math.min(PAGE_MAX, Math.max(1, Math.floor(o.n ?? PAGE_DEFAUT)));
  let fin = bulles.length;
  if (o.avant !== undefined) {
    const c = lireCurseur(o.avant);
    fin = 0;
    while (fin < bulles.length && (bulles[fin].date < c.date || (bulles[fin].date === c.date && bulles[fin].id < c.id))) fin++;
  }
  const debut = Math.max(0, fin - n), premier = new Map<string, number>();
  for (const b of bulles) if (!b.origine && !premier.has(b.session)) premier.set(b.session, b.date);
  const elements: ElementFil[] = [];
  let derniere: string | undefined; // la conversation du dernier message qui n'est pas du téléphone ni d'un écran
  for (let i = 0; i < fin; i++) {
    const { titre, marquee, ...b } = bulles[i];
    const ouvre = !b.origine && derniere !== b.session;
    if (!b.origine) derniere = b.session;
    if (i < debut) continue;
    if (ouvre) elements.push({ type: 'separateur', session: b.session, titre, debut: premier.get(b.session) ?? b.date, ...(marquee ? { marquee: true as const } : {}) });
    elements.push(b);
  }
  return { elements, suite: debut > 0 ? curseurDe(bulles[debut]) : null };
}

// ---------------------------------------------------------------- le masque
// « Masquer » (section 83 : « on peut masquer toute la conversation, ça repart sur une page vide complète où on peut
// réafficher toute l'historique ») : une marque « fil-masque:<session> » retient le dernier message du fil à cet
// instant ; le fil ne rend plus que les messages arrivés après, sauf quand la page demande tout (Historique : saut à un
// jour). Aucun message n'est effacé, déplacé ni réécrit. « Réafficher l'historique » retire la marque : tout revient.
// Masquer remet aussi Odin à neuf pour la suite (comme l'ancien « Nouvelle », resetSession) : il repart sans le contexte
// court d'avant, et les marques « contenu non fiable » de la conversation sont remises à zéro ; sa mémoire, son Cerveau
// et ses tâches ne bougent pas. Réafficher ne rend pas ce contexte à Odin : il ne rend que l'écran.
// Chacun pour son fil : le propriétaire (« web:principal ») ; un membre (« web:membre-<identifiant> »).

/** Ce que le masque lit et écrit dans la mémoire (une marque par personne, la remise à neuf de sa conversation). */
export interface MemoireMasque {
  getKv(k: string): string | undefined;
  setKv(k: string, v: string): void;
  getSession(id: string): unknown;
  resetSession(id: string): void;
  listSessions(limit?: number): Array<{ id: string; channel: string; title: string }>;
  allMessages(id: string): MessageBrut[];
}

/** La conversation que cette personne mène avec Odin (celle qu'Odin remet à neuf), undefined si elle n'en a pas. */
export function sessionDeQui(qui: QuiFil): string | undefined { return 'proprio' in qui ? SESSION_PRINCIPALE : sessionDuMembre(qui.login); }
/** La marque du masque de cette personne. */
export function cleMasque(qui: QuiFil): string | undefined { const s = sessionDeQui(qui); return s ? `fil-masque:${s}` : undefined; }
/** La personne dont c'est la conversation (Discussion du propriétaire, ou celle d'un membre), undefined pour une autre. */
export function quiDeSession(session: string): QuiFil | undefined {
  if (session === SESSION_PRINCIPALE) return { proprio: true };
  const m = /^web:membre-([\w-]{1,33})$/.exec(session);
  return m ? { login: m[1] } : undefined;
}

/** Les messages arrivés après la marque du masque (curseur « <date>-<numéro> » du dernier message masqué). */
export function apresMasque<B extends { date: number; id: number }>(bulles: B[], masque: string): B[] {
  let c: { date: number; id: number };
  try { c = lireCurseur(masque); } catch { return bulles; } // marque illisible : on montre tout plutôt que de cacher
  return bulles.filter((b) => b.date > c.date || (b.date === c.date && b.id > c.id));
}

/** Masque le fil de cette personne : l'écran repart vide, Odin repart à neuf. Rien n'est effacé. false : pas de fil. */
export function masquerFil(mu: MemoireMasque, qui: QuiFil, maintenant = Date.now()): boolean {
  const cle = cleMasque(qui), session = sessionDeQui(qui);
  if (!cle || !session) return false;
  const toutes = mu.listSessions(Number.MAX_SAFE_INTEGER).map((s) => ({ id: s.id, channel: s.channel, title: s.title }));
  const ids = new Set(sessionsDuFil(qui, toutes, { ecrans: true }));
  const dernier = assembler(toutes.filter((s) => ids.has(s.id)), (id) => mu.allMessages(id)).at(-1);
  mu.setKv(cle, dernier ? curseurDe(dernier) : `${maintenant}-0`);
  if (mu.getSession(session)) mu.resetSession(session);
  return true;
}

/** Réaffiche tout l'historique de cette personne (retire la marque). false : pas de fil. */
export function reafficherFil(mu: MemoireMasque, qui: QuiFil): boolean {
  const cle = cleMasque(qui); if (!cle) return false;
  mu.setKv(cle, '');
  return true;
}

/**
 * « /new » ou « masque la conversation » reçu par la passerelle, dans cette session : la Discussion du propriétaire ou
 * celle d'un membre est masquée (écran vide, Odin à neuf) ; une autre conversation (une messagerie, un écran) n'a pas
 * d'écran de fil à vider : Odin y repart seulement à neuf, comme avant.
 */
export function masquerSession(mu: MemoireMasque, session: string): void {
  const qui = quiDeSession(session);
  if (qui) { masquerFil(mu, qui); return; }
  mu.resetSession(session);
}
