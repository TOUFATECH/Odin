// Les sortes de widgets de la fenêtre d'Odin, réunies depuis les fichiers de famille (maquette validée « Accueil »,
// lot 23), et la seule fonction « la donnée d'un widget » : elle applique le public de la sorte (qui peut la voir) puis
// rend l'un des cinq états. Une nouvelle sorte s'écrit dans le fichier de sa famille, pas ici, ni dans gladsheim.ts.
import type { Widget } from '../modules/gladsheim.ts';
import { SORTES_AUJOURDHUI } from './aujourdhui.ts';
import { SORTES_INFOS } from './infos.ts';
import { SORTES_MAISON } from './maison.ts';
import { SORTES_ODIN } from './odin.ts';
import { SORTES_VEILLE } from './veille.ts';
import { SORTES_LISTES } from './listes.ts';
import { SORTES_APPLIS } from './applis.ts';
import type { EtatWidget, Famille, Lecteur, Public, SourceWidget, SorteWidget } from './sorte.ts';

export type { EtatWidget, Famille, Lecteur, Public, Qui, Ecran, SourceWidget, SorteWidget } from './sorte.ts';
export { ETATS } from './sorte.ts';

/** Toutes les sortes, famille par famille. */
export const SORTES = [...SORTES_INFOS, ...SORTES_ODIN, ...SORTES_MAISON, ...SORTES_AUJOURDHUI, ...SORTES_VEILLE, ...SORTES_LISTES, ...SORTES_APPLIS] as const;
type Sorte = (typeof SORTES)[number];
/** Les identifiants des sortes que cleanLayout accepte aujourd'hui (l'écran sait les dessiner). */
export type IdSortePosable = Extract<Sorte, { posable: true }>['id'];
/** Les identifiants de toutes les sortes déclarées. */
export type IdSorte = Sorte['id'];

const QUI: readonly unknown[] = ['proprietaire', 'membre', 'maison'];
const ECRANS: readonly unknown[] = ['accueil', 'maison'];
const PAR_ID: ReadonlyMap<string, SorteWidget> = new Map(SORTES.map((x) => [x.id, x as SorteWidget]));
/** La sorte d'un identifiant, ou rien (sorte inconnue). */
export const sorteDe = (id: unknown): SorteWidget | undefined => (typeof id === 'string' ? PAR_ID.get(id) : undefined);
/** Les sortes posables, dans l'ordre de leurs familles. */
export const sortesPosables = (): SorteWidget[] => SORTES.filter((x) => x.posable) as SorteWidget[];

/** Le public écrit d'une sorte ; rien d'écrit : propriétaire seul. */
export const publicDe = (s: SorteWidget): Public => s.public ?? 'proprietaire';
/** Une sorte qui ne quitte jamais l'accueil du propriétaire (constat G4). Une sorte inconnue : oui, par prudence. */
export const accueilSeulement = (kind: unknown): boolean => { const s = sorteDe(kind); return !s || s.accueilSeul === true; };
/** Peut-on la servir à l'écran de la maison (/maison), à qui que ce soit ? */
export const servieALaMaison = (kind: unknown): boolean => !accueilSeulement(kind);
/**
 * LA règle de l'écran de la maison (/maison) : une sorte peut-elle y aller, à qui que ce soit ? Jamais une sorte
 * réservée à l'accueil du propriétaire (constat G4), jamais une sorte « propriétaire seul » (son agenda, ses
 * recherches, ses sauvegardes… : un écran au mur se lit par toute la maison, même ouvert par sa session ou par une clé
 * « complet »), jamais une sorte qui lit toujours une appli de la vie privée (« ses alertes » : Forseti), jamais une
 * sorte inconnue. Les autres : selon leur public (droitDeVoir). Pur.
 */
export const admiseALaMaison = (kind: unknown): boolean => {
  const s = sorteDe(kind);
  return Boolean(s) && !s!.accueilSeul && publicDe(s!) !== 'proprietaire' && (s!.applis === 'choisie' || !s!.applis.some((a) => APPLIS_VIE_PRIVEE.includes(a)));
};
/** Peut-on la « copier vers l'autre écran » ? Jamais pour les quatre sortes réservées à l'accueil. */
export const copiable = (kind: unknown): boolean => !accueilSeulement(kind);

/**
 * Les applis de la vie privée (sa question 15) : ce qui dit où est la famille, ce qu'elle fait, ce qu'elle dit, ce
 * qu'elle garde. Un widget qui en lit une reste fermé à un membre et à une tablette, tant que le propriétaire ne l'a pas
 * ouvert pour cette personne, un par un (réponse b). Comparée au catalogue des applis d'Odin (essai) :
 * - où l'on est : les trajets et positions (Ulysse), les caméras (Cyclope), l'agenda et les rendez-vous (Chronos) ;
 * - ce que chacun regarde, écoute, joue, cherche, visite : Vénus, Apollon, Olympie, Pythie, le navigateur (Pégase),
 *   le journal DNS (Sphinx), les paquets du réseau (Ariane), les téléchargements (Atalante) ;
 * - ce que chacun dit : la voix (Orphée), la dictée (Écho) ;
 * - les appareils de chacun et qui est connecté : l'inventaire (Atlas), le Wi-Fi (Zéphyr), le parc d'ordinateurs
 *   (Satellites), les enfants et leurs appareils (Héra) ;
 * - ce que chacun garde : les photos (Hélios), les documents (Plume), les fichiers (Nébuleuse), le texte lu dans les
 *   photos et les papiers (Champollion), les fichiers retrouvés (Perséphone), les bases de données (Alexandrie) ;
 * - les secrets et les personnes : le coffre de mots de passe (Thésauros), les personnes et leurs comptes (Persona,
 *   Agora), la présence sur Internet (Gygès).
 */
export const APPLIS_VIE_PRIVEE: readonly string[] = [
  'gna', 'himinbjorg', 'frigg',
  'freyja', 'aegir', 'leikvangr', 'volva', 'pegase', 'vidarr', 'ran', 'atalante',
  'bragi', 'rodd',
  'askr', 'svalinn', 'hermod', 'heidrun',
  'sol', 'snotra', 'skidbladnir', 'champollion', 'hel', 'urdr',
  'brisingamen', 'var', 'agora', 'hlin',
  // Journaux des connexions et appareils du VPN : fermés aussi (choix du propriétaire, 25/11).
  'forseti', 'argos', 'mimisbrunnr', 'gjoll',
];

/**
 * La clé d'une ouverture : CE widget, pour CETTE appli. Ouvrir un widget n'ouvre que l'appli qu'il lisait quand le
 * propriétaire l'a ouvert : pointé ensuite sur une autre appli (même identifiant), il est de nouveau fermé.
 */
export const cleOuverture = (w: Pick<Widget, 'id'>, appli: string): string => `${w.id}@${appli}`;

/** Les applis que lit ce widget (celle qu'il a choisie, ou la liste fixe de sa sorte). */
export function applisLues(w: Pick<Widget, 'module'>, s: SorteWidget): string[] {
  return s.applis === 'choisie' ? (w.module ? [w.module] : []) : [...s.applis];
}
/** Le widget lit-il une appli de la vie privée ? */
export const vieprivee = (w: Pick<Widget, 'module'>, s: SorteWidget) => applisLues(w, s).some((a) => APPLIS_VIE_PRIVEE.includes(a));

/**
 * La famille qui compte pour une tablette : celle de la sorte, sauf pour une sorte « Odin » qui lit une appli de la
 * famille « Maison » d'Odin (Midgard, Cyclope…) : elle compte comme « maison » (la règle d'aujourd'hui, maison-api.ts).
 */
function familleVuePourTablette(w: Pick<Widget, 'module'>, s: SorteWidget, src: Pick<SourceWidget, 'appli'>): Famille {
  if (s.famille === 'odin' && w.module && src.appli(w.module)?.family === 'Maison') return 'maison';
  return s.famille;
}

/**
 * Le droit de voir ce widget, avant toute lecture. Rend `undefined` si la personne peut le voir, sinon l'état `refuse`.
 * Pur (la source ne sert qu'à connaître la famille d'une appli).
 */
export function droitDeVoir(w: Pick<Widget, 'id' | 'kind' | 'module'>, l: Lecteur, src: Pick<SourceWidget, 'appli'>): EtatWidget | undefined {
  const s = sorteDe(w.kind);
  if (!s) return { etat: 'refuse', raison: 'sorte_inconnue' };
  // Qui regarde doit être l'un des trois publics, sur l'un des deux écrans : toute autre valeur (un appelant qui se
  // trompe, des droits « complet » passés tels quels) est fermée.
  if (!QUI.includes(l?.qui) || !ECRANS.includes(l.ecran)) return { etat: 'refuse', raison: 'lecteur_inconnu' };
  // Les quatre sortes de l'accueil : à lui seul, sur l'accueil seul. Pas même au propriétaire sur l'écran de la maison.
  if (s.accueilSeul && (l.ecran !== 'accueil' || l.qui !== 'proprietaire')) return { etat: 'refuse', raison: 'accueil_du_proprietaire' };
  // L'écran de la maison : une sorte que la règle n'y admet pas (admiseALaMaison) n'y est servie à personne, lui compris.
  // Le refus ne remplace que le « oui » d'avant : un refus qui existait garde sa raison.
  const pasALaMaison = (): EtatWidget | undefined => (l.ecran === 'maison' && !admiseALaMaison(w.kind) ? { etat: 'refuse', raison: 'proprietaire_seul' } : undefined);
  if (l.qui === 'proprietaire') return pasALaMaison();
  const p = publicDe(s);
  if (p === 'proprietaire') return { etat: 'refuse', raison: 'proprietaire_seul' };
  if (l.qui === 'maison') {
    // Les chiffres ou une partie de page d'une appli de la famille « Maison » d'Odin : permis à une tablette, comme
    // aujourd'hui (maison-api.ts) ; toute autre appli : non. Puis, toujours, seulement les familles infos et maison.
    const f = familleVuePourTablette(w, s, src);
    if (!(p === 'maison' || (p === 'membre' && s.famille === 'odin' && f === 'maison'))) return { etat: 'refuse', raison: 'pas_pour_une_tablette' };
    if (f !== 'infos' && f !== 'maison') return { etat: 'refuse', raison: 'pas_pour_une_tablette' };
  }
  // Un membre : le droit sur chaque appli lue. Une tablette n'a de droit sur aucune appli : seulement son public.
  if (l.qui === 'membre') { const sans = applisLues(w, s).find((a) => !l.peutLire?.(a)); if (sans) return { etat: 'refuse', raison: 'appli_fermee', appli: sans }; }
  // La vie privée : fermée tant qu'il ne l'a pas ouverte à cette personne, widget par widget et pour l'appli lue.
  const fermee = applisLues(w, s).find((a) => APPLIS_VIE_PRIVEE.includes(a) && !l.ouverts?.has(cleOuverture(w, a)));
  if (fermee) return { etat: 'refuse', raison: 'vie_privee', appli: fermee };
  return pasALaMaison();
}

/**
 * LA donnée d'un widget, pour une personne et un écran : toujours l'un des cinq états, jamais une exception.
 * Les droits d'abord (rien n'est lu pour qui n'a pas le droit), puis la lecture propre à la sorte.
 */
export async function donneeWidget(w: Widget, l: Lecteur, src: SourceWidget): Promise<EtatWidget> {
  // Un droit qu'on n'a pas pu vérifier (la source a planté) : fermé, et jamais une exception.
  let non: EtatWidget | undefined;
  try { non = droitDeVoir(w, l, src); } catch { return { etat: 'refuse', raison: 'droit_non_verifie' }; }
  if (non) return non;
  const s = sorteDe(w.kind)!;
  if (!s.lire) return { etat: 'source_absente', raison: 'pas_encore_lu' };
  try {
    // Une appli fixe de la sorte (Hestia, pour l'heure et la météo) désactivée ou absente : rien n'est lu.
    if (Array.isArray(s.applis) && s.applis.some((a) => !src.appli(a))) return { etat: 'source_absente', raison: 'appli_absente' };
    return await s.lire(w, src, l);
  } catch { return { etat: 'source_absente', raison: 'lecture_echouee' }; }
}
