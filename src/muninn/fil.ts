// Le fil d'une personne : toutes ses conversations assemblées en une seule suite, dans l'ordre des dates, le titre de
// chacune en séparateur, lue par pages. Assemblage PUR : rien n'est déplacé, réécrit ni effacé ; on lit tous les
// messages des sessions (pas l'historique actif d'après la dernière compaction), donc la compaction ne cache rien ici.
//
// Qui lit quoi (le serveur décide d'après le compte connecté, jamais d'après la page) :
//   - le propriétaire : ses conversations de la Discussion, « web:principal » et les anciennes « web:c-… » ; ni les
//     portes d'autres écrans (maison, vénus, voix, cerveau, réglages…), ni celle d'un membre, ni un sous-agent ;
//     ni « web:raccourci » (POST /api/ask, ouvert par la clé d'API et non par une personne) : laissé à part, rien
//     n'est effacé, en attendant de savoir s'il entre dans le fil avec une étiquette ;
//     ses messageries seulement si l'appelant les passe (`messageries`, prévu pour plus tard, pas encore utilisé) ;
//   - un membre : sa conversation « web:membre-<identifiant> », rien d'autre.
//
// Pages : du plus récent au plus ancien. Le curseur `avant` (« <date>-<numéro> ») désigne le plus ancien message de la
// page lue ; la page suivante prend les messages strictement plus anciens. Un message arrivé pendant la lecture est plus
// récent que tout curseur déjà donné : il n'apparaît pas dans les pages plus anciennes (ni doublon ni trou).

export type QuiFil = { proprio: true } | { login: string };
export interface SessionFil { id: string; channel: string; title: string }
export interface MessageBrut { id: number; session_id: string; role: string; content: string; created_at: number }
/** Un message du fil : du texte, jamais du HTML (c'est à la page de l'afficher comme du texte). */
export interface Bulle { type: 'message'; id: number; session: string; role: 'user' | 'assistant'; texte: string; date: number }
/** Le début d'une conversation (ou sa reprise après une autre) : son titre et la date de son premier message. */
export interface Separateur { type: 'separateur'; session: string; titre: string; debut: number }
export type ElementFil = Bulle | Separateur;

export const SESSION_PRINCIPALE = 'web:principal';
/** Une conversation ouverte par « Nouvelle » dans la Discussion (« c- » + la date en base 36, 40 caractères au plus). */
const ANCIENNE = /^web:c-[a-z0-9]{1,38}$/;
export const PAGE_DEFAUT = 100, PAGE_MAX = 200;

/**
 * La session d'un membre, telle que la barre des applis la nomme. Un identifiant que ce nom raccourcirait ou changerait
 * (point, trop long) ne reçoit rien : deux personnes ne doivent jamais tomber sur la même session.
 */
export function sessionDuMembre(login: string): string | undefined {
  return /^[\w-]{1,33}$/.test(login) ? `web:membre-${login}` : undefined;
}

/** Les sessions qui forment le fil de cette personne, parmi celles qui existent. */
export function sessionsDuFil(qui: QuiFil, sessions: SessionFil[], o: { messageries?: string[] } = {}): string[] {
  const existe = new Map(sessions.map((s) => [s.id, s]));
  if ('proprio' in qui) {
    const web = sessions.filter((s) => s.id === SESSION_PRINCIPALE || ANCIENNE.test(s.id)).map((s) => s.id);
    // Les messageries : seulement des sessions qui existent et qui ne sont pas des sessions de l'interface.
    const autres = (o.messageries ?? []).filter((id) => { const s = existe.get(id); return Boolean(s && s.channel !== 'web' && !id.startsWith('web:')); });
    return [...new Set([...web, ...autres])];
  }
  const sienne = sessionDuMembre(qui.login);
  return sienne && existe.has(sienne) ? [sienne] : [];
}

/** Toutes les bulles de ces sessions, dans l'ordre des dates (puis des numéros) ; ni outils ni messages vides. */
export function assembler(sessions: SessionFil[], messagesDe: (id: string) => MessageBrut[]): Array<Bulle & { titre: string }> {
  const out: Array<Bulle & { titre: string }> = [];
  for (const s of sessions) {
    for (const m of messagesDe(s.id)) {
      if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content) continue;
      out.push({ type: 'message', id: m.id, session: s.id, role: m.role, texte: m.content, date: m.created_at, titre: s.title });
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
 * `suite` : le curseur de la page plus ancienne, ou null quand il n'y a plus rien au-dessus.
 */
export function lirePage(bulles: Array<Bulle & { titre: string }>, o: { n?: number; avant?: string }): { elements: ElementFil[]; suite: string | null } {
  const n = Math.min(PAGE_MAX, Math.max(1, Math.floor(o.n ?? PAGE_DEFAUT)));
  let fin = bulles.length;
  if (o.avant !== undefined) {
    const c = lireCurseur(o.avant);
    fin = 0;
    while (fin < bulles.length && (bulles[fin].date < c.date || (bulles[fin].date === c.date && bulles[fin].id < c.id))) fin++;
  }
  const debut = Math.max(0, fin - n), premier = new Map<string, number>();
  for (const b of bulles) if (!premier.has(b.session)) premier.set(b.session, b.date);
  const elements: ElementFil[] = [];
  for (let i = debut; i < fin; i++) {
    const { titre, ...b } = bulles[i];
    if (i === 0 || bulles[i - 1].session !== b.session) elements.push({ type: 'separateur', session: b.session, titre, debut: premier.get(b.session) ?? b.date });
    elements.push(b);
  }
  return { elements, suite: debut > 0 ? curseurDe(bulles[debut]) : null };
}
