// La famille « Maison » des widgets, la présence (maquette validée « Accueil ») : le petit chiffre « À la maison » et la
// carte « Famille ». Rangées dans ce fichier pour ne pas écrire dans ceux des autres parts de la famille ; AUCUN droit
// n'est élargi : ces deux sortes sont au propriétaire seul, sur son accueil seul, et portent la marque « jamais sur
// l'écran de la maison ». Ce qui les ferme est la règle commune (index.ts, droitDeVoir), puis un second verrou ici,
// avant toute lecture.
// D'où vient « là » (sa réponse du 27/11 : « avec la box ou une localisation que je fais ou bien une saisie ») :
// - la box d'abord : l'état qu'elle donne de chaque personne (« home » : là ; un autre état lisible, « not_home » ou le
//   nom d'une zone : pas là ; un état illisible : on ne sait pas) ;
// - sans box, ou pour un membre que la box ne connaît pas (le même nom, sans tenir compte des majuscules, comme
//   l'écran de la maison les réunit) : la dernière position que son téléphone a envoyée, comparée au lieu d'Odin par la
//   règle pure de Hestia (gladsheim.ts, presenceDe), à la maison près si le lieu vient de « Me localiser », à la ville
//   près s'il vient d'une ville saisie. Un lieu supposé, trouvé par la connexion, ou dont on ne sait pas comment il a été
//   réglé : rien n'est calculé, et l'état « vide » dit de le régler.
// Ce qui est servi, pour chaque personne : son nom, « là », « pas là », « on ne sait pas » ou « pas de nouvelles », la
// précision de la règle (la box, la maison, la ville) et l'âge de l'information. Jamais une position, une distance, une
// zone, une batterie, ni une heure de passage. Le petit chiffre ne sert aucun nom.
import type { Widget } from '../modules/gladsheim.ts';
import { etiquette } from './maison.ts';
import type { EtatWidget, Lecteur, SorteWidget, SourceWidget } from './sorte.ts';

/** Le propriétaire, sur son accueil : le seul à qui ces deux sortes rendent quelque chose (un second verrou, après droitDeVoir). */
const lui = (l: Lecteur) => l.qui === 'proprietaire' && l.ecran === 'accueil';
/** Les personnes servies au plus (le compte entier est toujours dit), et la longueur d'un nom servi. */
const PERSONNES_MAX = 24, NOM_MAX = 60;
type EtatPersonne = 'la' | 'pas_la' | 'inconnu' | 'sans_nouvelles';
/** `at` : le moment de la position reçue ; absent pour une personne de la box (Odin ne sait pas de quand date l'état qu'elle donne). */
interface Personne { nom: string; etat: EtatPersonne; precision: 'box' | 'maison' | 'ville'; at?: number }

const ILLISIBLES = new Set(['', 'unknown', 'unavailable', 'none', 'null', 'undefined']);
/** L'état qu'une box donne d'une personne : « home » = là ; un autre état lisible (« not_home », une zone) = pas là ; illisible = on ne sait pas. */
export function etatBox(e: unknown): 'la' | 'pas_la' | 'inconnu' {
  const x = typeof e === 'string' ? e.trim().toLowerCase() : '';
  return x === 'home' ? 'la' : ILLISIBLES.has(x) ? 'inconnu' : 'pas_la';
}
const nomLu = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, NOM_MAX) : '');
const cle = (nom: string) => nom.toLowerCase();

const lirePresence = (petit: boolean) => async (_w: Widget, src: SourceWidget, l: Lecteur): Promise<EtatWidget> => {
  if (!lui(l)) return { etat: 'refuse', raison: 'proprietaire_seul' };
  if (!src.presence) return { etat: 'source_absente', raison: 'pas_encore_lu' };
  const p = await src.presence();
  if (!p || !Array.isArray(p.positions)) return { etat: 'source_absente', raison: 'appli_muette' };
  const t = src.maintenant();
  // La règle de Hestia, lue à l'appel (comme les autres parts de la famille lisent Midgard).
  const { presenceDe } = await import('../modules/gladsheim.ts');
  const liste: Personne[] = [], connus = new Set<string>();
  for (const x of Array.isArray(p.box) ? p.box : []) {
    const nom = nomLu(x?.nom); if (!nom) continue;
    connus.add(cle(nom)); liste.push({ nom, etat: etatBox(x.etat), precision: 'box' });
  }
  const lieu = p.lieu, utilisable = (lieu?.par === 'position' || lieu?.par === 'ville') && typeof lieu.lat === 'number' && typeof lieu.lon === 'number';
  let aRegler = false;
  for (const f of p.positions) {
    const nom = nomLu(f?.nom); if (!nom || connus.has(cle(nom))) continue;
    if (!utilisable) { aRegler = true; continue; }
    const r = presenceDe(f, lieu, t);
    liste.push({ nom, etat: r === 'ancienne' ? 'sans_nouvelles' : r, precision: lieu.par === 'position' ? 'maison' : 'ville', at: Number.isFinite(f.at) && f.at <= t ? f.at : t });
  }
  // Une box qui ne répond pas, et personne d'autre de compté : jamais « personne n'est suivi » ni « lieu à régler » seul.
  if (!liste.length && p.boxMuette === true) return { etat: 'source_absente', raison: 'appli_muette' };
  if (!liste.length) return { etat: 'vide', raison: aRegler ? 'lieu_a_regler' : 'personne' };
  const la = liste.filter((x) => x.etat === 'la').length, sur = la + liste.filter((x) => x.etat === 'pas_la').length;
  // Le petit chiffre sans personne dont on sache quelque chose : jamais « 0 / 0 ».
  if (petit && !sur) return { etat: 'vide', raison: 'sans_nouvelles' };
  // La réserve : dès qu'une personne comptée l'est à la ville près.
  const ville = liste.some((x) => x.precision === 'ville' && (x.etat === 'la' || x.etat === 'pas_la'));
  // L'âge de la carte : la plus ancienne position reçue ; la box seule : le moment de sa lecture (comme les autres widgets).
  const ats = liste.flatMap((x) => (x.at === undefined ? [] : [x.at]));
  return { etat: 'ok', at: ats.length ? Math.min(...ats) : t, donnee: {
    la, sur, total: liste.length, ...(ville ? { villeSeulement: true } : {}), ...(aRegler ? { lieuARegler: true } : {}),
    ...(petit ? {} : { personnes: liste.slice(0, PERSONNES_MAX).map((x) => ({ nom: x.nom, etat: x.etat, precision: x.precision, ...(x.at === undefined ? {} : { at: x.at }) })) }),
  } };
};

// L'appli lue : Ulysse (la maquette : « Qui est à la maison (Ulysse) », « Ulysse : qui est où ») ; désactivée, rien n'est lu.
const base = { famille: 'maison', applis: ['gna'], styles: ['simple'], posable: true, jamaisALaMaison: true, nettoyer: etiquette } as const;

export const SORTES_MAISON_PRESENCE = [
  // « À la maison » (la maquette, « k-people » : 2 × 1). Combien sont là, sur combien dont on sait quelque chose.
  { id: 'maison_presence', ...base, taille: { mini: [2, 1], r: 1 }, lire: lirePresence(true) },
  // « Famille » (la maquette, « gna » : 3 × 2). Une pastille par personne : là, pas là, on ne sait pas, pas de nouvelles.
  { id: 'maison_famille', ...base, taille: { mini: [3, 2], r: 2 }, lire: lirePresence(false) },
] as const satisfies readonly SorteWidget[];
