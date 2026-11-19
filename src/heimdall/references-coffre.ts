// Heimdall — les RÉFÉRENCES au coffre : « coffre:Nom/champ ».
//
// Demande du propriétaire (19/11, section 86) : « les mots de passe, ils sont jamais visibles dans la conversation de
// l'agent IA. L'agent IA, en fait, il demande de remplir un mot de passe et ensuite c'est le serveur qui lui-même vient
// remplir ce mot de passe » ; et pour la box (19/11) : « il met dans son coffre […] le mettre directement dans le coffre
// et c'est tout il fait le travail, il peut aller dans la box pour faire le nécessaire ».
//
// Un agent (le modèle, un agent connecté) n'a jamais la valeur d'un secret : il écrit une RÉFÉRENCE, par exemple
// « coffre:Box/mot de passe » (le nom et le champ qu'il voit dans « [rangé au coffre : Box — mot de passe] »), dans
// l'entrée d'un outil. Le serveur (src/heimdall/executer.ts, le seul chemin vers un outil) la remplace par la valeur
// du coffre juste avant l'outil, sur une copie neuve de l'entrée validée ; ce qui est demandé, montré, numéroté et
// noté garde la référence. Ce fichier dit OÙ c'est permis et lit le coffre de la bonne personne :
//   - une LISTE FERMÉE d'outils et de champs (PLACES_PERMISES, écrite ici, dans le noyau) ; une référence ailleurs
//     (un courriel, une requête, une commande, un champ imbriqué) est refusée ;
//   - le coffre de la personne qui demande : le propriétaire lit le sien, un membre le sien ; un invité, rien ;
//   - prise en main d'une machine et administration de ce poste : jamais après la lecture d'un contenu extérieur, ni
//     depuis une tâche automatique (la machine visée est choisie par l'agent : une page piégée ne doit pas pouvoir y
//     envoyer un mot de passe du coffre) ;
//   - remplir un identifiant de site : seulement l'identifiant ou le mot de passe d'un élément qui a un site, et
//     seulement quand la page ouverte dans le navigateur est sur CE site (même protocole, même hôte, même port). La page
//     est lue dans le navigateur au moment même (avant la question, puis juste avant l'outil), jamais retenue : il n'y a
//     qu'un navigateur par dossier d'Odin, et une recherche web, une autre conversation ou une tâche peut le mener
//     ailleurs à tout moment.
// Rien n'est écrit, rien n'est journalisé ici ; aucun message ne porte une valeur.
import { join } from 'node:path';
import { vaultState } from '../vault.ts';

/** Une place où une référence est permise : l'outil, le champ (au premier niveau de l'entrée), les champs du coffre. */
export interface PlacePermise {
  outil: string;
  champ: string;
  /** Les champs du coffre qu'on peut y mettre. */
  champsDuCoffre: readonly string[];
  /** Le champ n'accepte QU'une référence (jamais une valeur écrite par l'agent). */
  seulementReference: boolean;
  /** L'élément du coffre doit avoir un site, et la page ouverte doit être sur ce site. */
  site: boolean;
  /** Jamais après un contenu extérieur lu ni depuis une tâche automatique. */
  conversationPropre: boolean;
}

/** La liste FERMÉE : prendre la main sur une machine, devenir administrateur de ce poste, remplir un identifiant de site. */
export const PLACES_PERMISES: readonly PlacePermise[] = Object.freeze([
  Object.freeze({ outil: 'machine_onboard', champ: 'password', champsDuCoffre: Object.freeze(['mot de passe']), seulementReference: true, site: false, conversationPropre: true }),
  Object.freeze({ outil: 'admin_enable', champ: 'password', champsDuCoffre: Object.freeze(['mot de passe']), seulementReference: true, site: false, conversationPropre: true }),
  Object.freeze({ outil: 'browser_type', champ: 'text', champsDuCoffre: Object.freeze(['identifiant', 'mot de passe']), seulementReference: false, site: true, conversationPropre: false }),
]);

const placeDe = (outil: string, champ: string): PlacePermise | undefined => PLACES_PERMISES.find((p) => p.outil === outil && p.champ === champ);
const LISTE = PLACES_PERMISES.map((p) => `${p.outil} (« ${p.champ} »)`).join(', ');

/**
 * Ce qui ressemble à une référence, n'importe où dans un texte (pour la refuser hors de la liste) : « coffre: » collé à la
 * suite (une phrase comme « le coffre : ouvert/fermé » n'en est pas une).
 */
const DANS_UN_TEXTE = /(?<![\p{L}\p{N}_])coffre:[^\s/][^\n/]{0,200}\/[ \t]*\S/iu;

/** Une valeur qui EST une référence (seule, espaces autour permis) : le nom (jusqu'au DERNIER « / ») et le champ. Pur. */
export function lireReference(v: unknown): { nom: string; champ: string } | undefined {
  if (typeof v !== 'string' || v.length > 500) return undefined;
  const t = v.trim();
  if (!/^coffre:\S/i.test(t) || /[\r\n]/.test(t)) return undefined;
  const reste = t.slice('coffre:'.length), i = reste.lastIndexOf('/');
  if (i < 0) return undefined;
  const nom = reste.slice(0, i).trim(), champ = reste.slice(i + 1).trim();
  return nom && champ ? { nom, champ } : undefined;
}

/** La référence écrite comme l'agent l'écrit (ce qui remplace la valeur dans une sortie d'outil). */
export const texteReference = (nom: string, champ: string): string => `coffre:${nom}/${champ}`;

export interface ReferenceTrouvee { champ: string; nom: string; champCoffre: string }

/** Les chaînes d'une entrée (bornées), avec leur chemin (« a.b[0] ») : une clé de premier niveau a pour chemin son nom. */
function chaines(v: unknown, chemin: string, out: Array<{ chemin: string; v: string }>, prof = 0): void {
  if (out.length >= 256 || prof > 12) return;
  if (typeof v === 'string') out.push({ chemin, v });
  else if (Array.isArray(v)) v.forEach((x, k) => chaines(x, `${chemin}[${k}]`, out, prof + 1));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) chaines(x, chemin ? `${chemin}.${k}` : k, out, prof + 1);
}

/**
 * Les références d'une entrée d'outil, et le refus si l'une n'est pas à une place permise (ou si un champ qui n'accepte
 * qu'une référence porte une valeur). Pur. Une chaîne au-delà des bornes n'est pas lue : elle n'est pas remplacée non
 * plus (rien ne peut fuir par là, la référence part telle quelle).
 */
export function referencesDe(outil: string, entree: Record<string, unknown>): { refs: ReferenceTrouvee[]; refus?: string } {
  const refs: ReferenceTrouvee[] = [];
  const e = entree && typeof entree === 'object' ? entree : {};
  // Un champ qui n'accepte qu'une référence : jamais une valeur (nombre, objet…) écrite par l'agent.
  for (const p of PLACES_PERMISES) if (p.outil === outil && p.seulementReference && Object.hasOwn(e, p.champ) && e[p.champ] !== undefined && typeof e[p.champ] !== 'string') return { refs: [], refus: `le champ « ${p.champ} » de ${outil} n'accepte qu'une référence au coffre (coffre:Nom/mot de passe), jamais une valeur` };
  const toutes: Array<{ chemin: string; v: string }> = [];
  chaines(e, '', toutes);
  for (const { chemin, v } of toutes) {
    const p = Object.hasOwn(e, chemin) ? placeDe(outil, chemin) : undefined;
    const r = lireReference(v);
    if (p) {
      if (r) {
        if (!p.champsDuCoffre.includes(r.champ)) return { refs: [], refus: `dans ${outil}, une référence au coffre ne peut porter que ${p.champsDuCoffre.map((c) => `« ${c} »`).join(' ou ')} (pas « ${r.champ} »)` };
        refs.push({ champ: chemin, nom: r.nom, champCoffre: r.champ });
        continue;
      }
      if (DANS_UN_TEXTE.test(v)) return { refs: [], refus: `une référence au coffre doit être seule dans le champ « ${chemin} » de ${outil}` };
      if (p.seulementReference && v.trim()) return { refs: [], refus: `le champ « ${chemin} » de ${outil} n'accepte qu'une référence au coffre (coffre:Nom/mot de passe), jamais une valeur` };
      continue;
    }
    if (r || DANS_UN_TEXTE.test(v)) return { refs: [], refus: `une référence au coffre n'est permise que dans ${LISTE} : ici (${outil}, « ${chemin || '(entrée)'} »), elle est refusée et rien n'est remplacé` };
  }
  return { refs };
}

/** Qui demande : le propriétaire (son coffre), ou un membre (le sien, reconnu par son identifiant). */
export type Demandeur = { role: 'owner' } | { role: 'member'; id: string };

/** Qui demande, d'après le contexte de l'outil (posé par la boucle de l'agent et la passerelle). Un invité, ou personne : undefined. */
export function demandeurDe(ctx: { auteur?: { role?: string }; channel?: string; peer?: string; muninn?: unknown }): Demandeur | undefined {
  const role = ctx?.auteur?.role;
  if (role === 'owner') return { role: 'owner' };
  if (role !== 'member') return undefined;
  let u: { id?: unknown; role?: unknown } | undefined;
  try { u = (ctx.muninn as { userFor?(c: string, p: string): { id?: unknown; role?: unknown } | undefined } | undefined)?.userFor?.(String(ctx.channel ?? ''), String(ctx.peer ?? '')); } catch { u = undefined; }
  const id = typeof u?.id === 'string' ? u.id.trim() : '';
  return u?.role === 'member' && id ? { role: 'member', id } : undefined;
}

/** Un élément du coffre (Thésauros), tel que lu : seuls ces champs servent ici. */
export interface ElementLu { name: string; user?: string; password?: string; url?: string; champs?: Record<string, string>; membre?: string }

// Même nom = même forme composée, sans la casse ni les espaces en trop (la règle du rangement, brisingamen.ts).
const cleNom = (n: string) => String(n ?? '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * Cherche « nom / champ » dans le coffre de `qui` SEULEMENT (le propriétaire : les éléments sans membre ; un membre :
 * les siens). Le message est le même qu'un élément existe ailleurs ou pas. Pur.
 */
export function trouverDansLeCoffre(items: readonly ElementLu[], qui: Demandeur, nom: string, champ: string): { valeur: string; url?: string } | { refus: string } {
  const membre = qui.role === 'member' ? qui.id : '';
  if (qui.role === 'member' && !membre) return { refus: 'je ne sais pas à quel coffre tu as droit' };
  const it = (Array.isArray(items) ? items : []).find((i) => i && (i.membre ?? '') === membre && cleNom(i.name) === cleNom(nom));
  if (!it) return { refus: `« ${nom} » n'est pas dans ton coffre` };
  const v = champ === 'identifiant' ? it.user : champ === 'mot de passe' ? it.password : Object.hasOwn(it.champs ?? {}, champ) ? it.champs![champ] : undefined;
  if (typeof v !== 'string' || !v) return { refus: `« ${nom} » n'a pas de ${champ} dans ton coffre` };
  return { valeur: v, url: it.url };
}

/** Même site : même protocole (http ou https), même hôte, même port. Un élément sans protocole est pris en https. Pur. */
export function memeSite(siteElement: string | undefined, page: string | undefined): boolean {
  if (!siteElement || !page) return false;
  try {
    const a = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(siteElement) ? siteElement : `https://${siteElement}`), b = new URL(page);
    return (a.protocol === 'http:' || a.protocol === 'https:') && a.protocol === b.protocol && a.host === b.host && a.host !== '';
  } catch { return false; }
}

/**
 * La page RÉELLEMENT ouverte dans le navigateur d'Odin, lue au moment même (jamais retenue d'un appel à l'autre) : il n'y
 * a qu'un navigateur par dossier d'Odin (src/tools/browser.ts), mené aussi par la recherche web, les autres conversations
 * et les tâches. Navigateur fermé, ou page qui ne répond pas : undefined (et la référence est refusée). Le navigateur
 * n'est jamais démarré pour cette lecture. Limite connue : l'adresse est rapportée par un script exécuté dans la page
 * (src/browser/browser.ts, look) ; la garantie stricte (adresse lue par le protocole du navigateur, origine revérifiée
 * entre le clic et la frappe de type()) se fait dans src/browser/browser.ts.
 */
export async function pageReelle(home: string | undefined): Promise<string | undefined> {
  if (!home) return undefined;
  try {
    const { browserFor } = await import('../tools/browser.ts');
    const b = browserFor(home, process.env.ODIN_BROWSER_VISIBLE === '1');
    if (!b.running) return undefined;
    let fin: NodeJS.Timeout | undefined;
    const l = await Promise.race([b.look(), new Promise<undefined>((ok) => { fin = setTimeout(() => ok(undefined), 5000); fin.unref?.(); })]).finally(() => clearTimeout(fin));
    return typeof l?.url === 'string' && l.url ? l.url : undefined;
  } catch { return undefined; }
}

/** L'origine d'une adresse (protocole, hôte, port) : ce qui est vérifié, et ce qui est montré dans la question. Pur. */
export function origineDe(adresse: string | undefined): string | undefined {
  try { const u = new URL(String(adresse ?? '')); return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : undefined; } catch { return undefined; }
}

/** Le coffre (Thésauros) : fermé (sans sa clé, ou coffre d'Odin verrouillé) ou illisible → un refus, jamais une erreur brute. */
export async function lireLeCoffre(home: string | undefined): Promise<ElementLu[] | { refus: string }> {
  if (!home) return { refus: 'je ne trouve pas mon coffre' };
  let ferme = !/^[a-f0-9]{64}$/.test(process.env.BRISINGAMEN_KEY ?? '');
  if (!ferme) { try { ferme = vaultState(home) === 'locked'; } catch { ferme = true; } }
  if (ferme) return { refus: 'ton coffre est fermé : ouvre-le, puis redemande' };
  try {
    const { load } = await import('../valhalla/modules/brisingamen.ts');
    const items = load({ dir: join(home, 'valhalla', 'brisingamen') } as never) as unknown;
    return Array.isArray(items) ? items as ElementLu[] : [];
  } catch { return { refus: 'je n\'ai pas pu ouvrir ton coffre' }; } // aucun message d'erreur : il pourrait porter une valeur
}

/** Le contexte qu'il faut pour vérifier et remplacer (un morceau de ToolContext et de la demande faite à Heimdall). */
export interface ContexteReference {
  home?: string; sessionId: string; channel?: string; peer?: string; auteur?: { role?: string }; muninn?: unknown;
  tainted?: boolean; suspicious?: boolean; unattended?: boolean; automatique?: boolean;
}

/** Une valeur remplacée : la valeur (en mémoire vive, le temps de l'outil), la référence qui la remplace, le champ du coffre. */
export interface Remplacee { valeur: string; par: string; champ: string }

/**
 * Vérifie les références d'un appel (place permise, personne, conversation, site, présence au coffre) et, si `remplacer`,
 * rend une COPIE de l'entrée où chaque référence est remplacée par sa valeur, avec la liste de ce qui a été remplacé
 * (pour retirer les valeurs de la sortie de l'outil). Sans référence : l'entrée telle quelle. `dit` : ce que la question
 * au propriétaire ajoute (l'élément du coffre et, pour un site, l'origine de la page lue à l'instant), sans aucune
 * valeur. Rien n'est écrit.
 */
export async function verifierReferences(outil: string, entree: Record<string, unknown>, c: ContexteReference, remplacer = false): Promise<{ refus: string } | { entree: Record<string, unknown>; remplacees: Remplacee[]; dit?: string }> {
  const { refs, refus } = referencesDe(outil, entree);
  if (refus) return { refus };
  if (!refs.length) return { entree, remplacees: [] };
  const qui = demandeurDe(c);
  if (!qui) return { refus: 'une référence au coffre ne sert qu\'au propriétaire ou à un membre, chacun pour son propre coffre' };
  for (const r of refs) {
    const p = placeDe(outil, r.champ)!;
    if (p.conversationPropre && (c.tainted || c.suspicious)) return { refus: `je ne donne pas un secret du coffre à ${outil} après avoir lu un contenu extérieur dans cette conversation (dis « /new » ou « masque la conversation » pour repartir à neuf, puis redemande)` };
    if (p.conversationPropre && (c.unattended || c.automatique)) return { refus: `je ne donne pas un secret du coffre à ${outil} depuis une tâche automatique` };
  }
  const items = await lireLeCoffre(c.home);
  if (!Array.isArray(items)) return items;
  const copie: Record<string, unknown> = { ...entree };
  const remplacees: Remplacee[] = [];
  const dits: string[] = [];
  for (const r of refs) {
    const t = trouverDansLeCoffre(items, qui, r.nom, r.champCoffre);
    if ('refus' in t) return t;
    let sur = '';
    if (placeDe(outil, r.champ)!.site) {
      if (!t.url) return { refus: `« ${r.nom} » n'a pas de site dans ton coffre : je ne sais pas où son ${r.champCoffre} peut être tapé (ajoute le site dans Thésauros)` };
      // La page lue à l'instant dans le navigateur (jamais une page retenue d'avant).
      const page = await pageReelle(c.home);
      if (!memeSite(t.url, page)) return { refus: `la page ouverte dans le navigateur n'est pas le site de « ${r.nom} » : je ne tape son ${r.champCoffre} que sur son site (ouvre-le d'abord)` };
      sur = `, sur ${origineDe(page)}`;
    }
    dits.push(`« ${r.nom} — ${r.champCoffre} » de ton coffre${sur}`);
    if (!remplacer) continue; // une simple vérification ne garde aucune valeur
    copie[r.champ] = t.valeur;
    remplacees.push({ valeur: t.valeur, par: texteReference(r.nom, r.champCoffre), champ: r.champCoffre });
  }
  const dit = `le serveur y met ${dits.join(' et ')}`;
  return remplacer ? { entree: copie, remplacees, dit } : { entree, remplacees: [], dit };
}

/** Retire de `texte` toute apparition des valeurs remplacées (la plus longue d'abord) : la référence revient à sa place. Pur. */
export function retirerValeurs(texte: string, remplacees: ReadonlyArray<{ valeur: string; par: string }>): string {
  let t = String(texte ?? '');
  for (const { valeur, par } of [...remplacees].sort((a, b) => b.valeur.length - a.valeur.length)) if (valeur) t = t.split(valeur).join(`[${par}]`);
  return t;
}
