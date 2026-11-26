// La famille « Maison » des widgets, ses appareils (maquette validée « Accueil » : la tuile d'un appareil, la lumière, le
// capteur, les pièces). Rangée dans un fichier à part de maison.ts : la même famille, le même public, aucun droit de plus.
// - Un appareil (tuile), une lumière, un capteur : chacun montre UN appareil, celui que le propriétaire a choisi (le champ
//   `cible` du widget : « appareil:<identifiant> ») parmi ceux que l'écran de la maison reçoit déjà (etat.rooms de
//   /api/maison/etat, lus par Midgard) ; son nom, sa pièce, son état vrai, et TOUTES les commandes de sa carte
//   d'aujourd'hui (le modèle COMMANDES_APPAREIL de gladsheim.ts, réutilisé tel quel). Rien n'est commandé ici : la page
//   passe par la route qui existe (POST /api/maison/appareil), avec ses vérifications.
// - Hors ligne : dit, et aucune commande (elle mentirait). Sans nouvelles depuis plus de 24 h : dit, l'état n'est pas
//   affirmé. Une valeur n'est jamais inventée : ni intensité de départ (Odin ne la lit pas), ni consigne de clim qui n'est
//   pas un nombre lu.
// - Ce qui ouvre la maison (une serrure, un garage, un portail : la règle de Midgard, sensitive) : pour le propriétaire,
//   la commande porte `accord` (le serveur le redemande à chaque fois) ; à une tablette « maison », elle n'est pas
//   servie (la route la lui refuse de toute façon).
// - Les pièces : chacune, combien d'appareils, ce qui y est allumé, et ses lumières (pour tout allumer ou éteindre d'un
//   geste, lumière par lumière, par la même route).
// Qui voit : comme les petits chiffres de la maison — le propriétaire, une tablette « maison » (elle reçoit déjà ces
// appareils) ; jamais un membre (l'écran de la maison ne lui donne rien), sans une lecture.
import type { Widget } from '../modules/gladsheim.ts';
import type { AppareilVu, EtatWidget, Lecteur, SorteWidget, SourceWidget } from './sorte.ts';

/**
 * Les règles des petits chiffres de la maison (maison.ts), lues telles quelles et jamais recopiées : « frais » (ni hors
 * ligne, ni muet depuis plus de 24 h), « allumé » (vrai, faux, ou on ne sait pas) et « un nombre écrit en entier ».
 * Lues à l'appel : maison.ts lit ce fichier à son chargement.
 */
type Regles = Pick<typeof import('./maison.ts'), 'frais' | 'enMarche' | 'nombre'>;
const regles = async (): Promise<Regles> => { const { frais, enMarche, nombre } = await import('./maison.ts'); return { frais, enMarche, nombre }; };

/**
 * Ce qu'un widget a choisi, nettoyé : « appareil:<id> » ou « piece:<nom> » (seulement les genres permis), 200 signes au
 * plus (plus long : refusé, jamais coupé). Les noms que porte tout objet (« __proto__ », « constructor », « prototype »)
 * ne sont jamais un choix.
 */
const CIBLE_MAX = 200;
const RESERVES = new Set(['__proto__', 'constructor', 'prototype']);
export function cibleNette(v: unknown, genres: readonly ('appareil' | 'piece')[], str: (v: unknown, n: number) => string): string | undefined {
  if (typeof v !== 'string' || v.length > CIBLE_MAX * 4) return undefined;
  const t = str(v, CIBLE_MAX + 10), m = /^(appareil|piece):(.+)$/s.exec(t);
  if (!m || !genres.includes(m[1] as 'appareil' | 'piece') || t.length > CIBLE_MAX || RESERVES.has(m[2].trim())) return undefined;
  return m[2].trim() ? t : undefined;
}
/** Le choix lu d'un widget : { genre, valeur }, ou rien (un nom réservé n'est jamais un choix). */
export function cibleDe(w: Pick<Widget, 'cible'>): { genre: 'appareil' | 'piece'; valeur: string } | undefined {
  const m = typeof w.cible === 'string' ? /^(appareil|piece):(.+)$/s.exec(w.cible) : null;
  return m && !RESERVES.has(m[2].trim()) ? { genre: m[1] as 'appareil' | 'piece', valeur: m[2] } : undefined;
}

/**
 * La liste des choix de « Régler » (l'appareil, la pièce ou le capteur que le widget montre) : servie avec l'état du
 * widget, au propriétaire seul et sur l'accueil seul (« Régler » n'existe que là) ; jamais à un membre, ni à une
 * tablette, ni à une clé « complet » sur l'écran de la maison. Un choix : sa cible, le nom et la pièce de l'appareil
 * (un nom vide reste vide : la page écrit sa sorte, jamais l'identifiant), sa sorte, et s'il est hors ligne (il reste
 * choisissable). Une pièce : sa cible et son nom. Au plus CHOIX_MAX.
 */
export interface Choix { cible: string; nom: string; piece?: string; sorte?: string; horsLigne?: true }
const CHOIX_MAX = 300;
const pourRegler = (l: Lecteur) => l.qui === 'proprietaire' && l.ecran === 'accueil';
const choixAppareil = (a: AppareilVu): Choix => ({ cible: `appareil:${a.id}`, nom: a.nom ?? '', piece: a.piece, sorte: a.sorte, ...(a.enLigne === false ? { horsLigne: true as const } : {}) });
/** Les appareils du bon genre (avec un identifiant, bien formé). */
const choixAppareils = (liste: readonly AppareilVu[], garder: (a: AppareilVu) => boolean): Choix[] =>
  liste.filter((a) => a.id && garder(a) && cibleNette(`appareil:${a.id}`, ['appareil'], (v) => String(v)) !== undefined).slice(0, CHOIX_MAX).map(choixAppareil);
/** Les pièces qui ont au moins un capteur de cette mesure, dans l'ordre de l'écran de la maison, puis ces capteurs. */
const choixMesure = (liste: readonly AppareilVu[], est: (a: AppareilVu) => boolean): Choix[] => {
  const les = liste.filter(est), pieces = [...new Set(les.map((a) => a.piece).filter((p) => cibleNette(`piece:${p}`, ['piece'], (v) => String(v)) !== undefined))];
  return [...pieces.map((p) => ({ cible: `piece:${p}`, nom: p })), ...choixAppareils(les, () => true)].slice(0, CHOIX_MAX);
};
/** L'état, et la liste des choix pour lui seul (posée à côté de l'état : la donnée montrée n'en change pas). */
const avecLesChoix = (e: EtatWidget, l: Lecteur, choix: () => Choix[]): EtatWidget => (pourRegler(l) ? Object.assign({}, e, { choix: choix() }) : e);

/** La lecture commune : jamais pour un membre (sans rien lire) ; Midgard muette : rien ; puis le calcul de la sorte. */
const lecture = (calcul: (liste: readonly AppareilVu[], t: number, w: Widget, l: Lecteur, r: Regles) => Promise<EtatWidget> | EtatWidget) => async (w: Widget, src: SourceWidget, l: Lecteur): Promise<EtatWidget> => {
  if (l.qui === 'membre') return { etat: 'refuse', raison: 'proprietaire_seul' };
  if (!src.appareilsMaison) return { etat: 'source_absente', raison: 'pas_encore_lu' };
  const a = await src.appareilsMaison();
  if (!a || !Array.isArray(a.appareils)) return { etat: 'source_absente', raison: 'appli_muette' };
  return calcul(a.appareils, src.maintenant(), w, l, await regles());
};

/** Une commande servie à la page : le modèle de la carte d'aujourd'hui, plus `accord` quand un de ses ordres ouvre la maison. */
interface CommandeServie { code: string; ordres: string[]; nombre?: { min?: number; max?: number; pas?: number; ordre: string }; geste?: 'glisser'; accord?: true }
/**
 * Les commandes d'un appareil pour qui regarde : celles du modèle (COMMANDES_APPAREIL), seulement s'il reçoit des ordres
 * et n'est pas hors ligne. Un ordre qui ouvre la maison (la règle de Midgard) : `accord` pour le propriétaire ; à une
 * tablette, la commande n'est pas servie. Lus à l'appel (gladsheim.ts lit ce fichier à son chargement).
 */
async function commandesDe(a: AppareilVu, l: Lecteur): Promise<CommandeServie[]> {
  if (a.enLigne === false || a.commandable === false || !a.id) return [];
  const [{ COMMANDES_APPAREIL }, { sensitive }] = await Promise.all([import('../modules/gladsheim.ts'), import('../modules/midgard.ts')]);
  if (!Object.hasOwn(COMMANDES_APPAREIL, a.sorte)) return [];
  const out: CommandeServie[] = [];
  for (const c of COMMANDES_APPAREIL[a.sorte]) {
    const grave = Boolean(c.accord) || c.ordres.some((o) => Boolean(sensitive(a.id!, o)));
    if (grave && l.qui !== 'proprietaire') continue;
    out.push({ code: c.code, ordres: [...c.ordres], ...(c.nombre ? { nombre: { ...c.nombre } } : {}), ...(c.geste ? { geste: c.geste } : {}), ...(grave ? { accord: true as const } : {}) });
  }
  return out;
}

/** Un appareil choisi : son nom, sa pièce, son état vrai, et ses commandes. */
const unAppareil = (garder: (a: AppareilVu) => boolean) => lecture(async (liste, t, w, l, r) => avecLesChoix(await unAppareilLu(garder, liste, t, w, l, r), l, () => choixAppareils(liste, garder)));
async function unAppareilLu(garder: (a: AppareilVu) => boolean, liste: readonly AppareilVu[], t: number, w: Widget, l: Lecteur, { frais, enMarche, nombre }: Regles): Promise<EtatWidget> {
  const c = cibleDe(w);
  // Pas encore choisi : à choisir, sauf s'il n'y a dans la maison aucun appareil de ce genre (« vide » le dit).
  if (!c || c.genre !== 'appareil') return { etat: 'vide', raison: liste.some((a) => a.id && garder(a)) ? 'appareil_non_choisi' : 'aucun_appareil' };
  const a = liste.find((x) => x.id === c.valeur);
  if (!a) return { etat: 'vide', raison: 'appareil_absent' };
  // Relié, mais d'une autre sorte (une lumière choisie pour un capteur) : dit tel quel, jamais « plus relié ».
  if (!garder(a)) return { etat: 'vide', raison: 'appareil_autre_sorte' };
  const horsLigne = a.enLigne === false, muet = !horsLigne && !frais(a, t);
  const sait = !horsLigne && !muet, allume = sait ? enMarche(a) : undefined, n = sait ? nombre(a.etat) : undefined;
  // Un nom vide reste vide (la page écrit la sorte) : jamais l'identifiant brut à sa place.
  return { etat: 'ok', at: typeof a.vuA === 'number' ? a.vuA : t, donnee: {
    id: a.id, nom: a.nom ?? '', piece: a.piece, sorte: a.sorte, ...(sait ? { etat: a.etat, unite: a.unite } : {}),
    ...(allume === undefined ? {} : { allume }), ...(horsLigne ? { horsLigne: true } : {}), ...(muet ? { muet: true } : {}),
    // La consigne d'une clim, seulement si son état est un nombre lu (comme la carte d'aujourd'hui) ; la valeur d'un capteur.
    ...(n !== undefined && a.sorte === 'clim' ? { consigne: n } : {}), ...(n !== undefined && a.sorte !== 'clim' ? { valeur: n } : {}),
    ...(typeof a.vuA === 'number' ? {} : { ageInconnu: true }),
    commandes: await commandesDe(a, l) } };
}

/** Les pièces : chacune (dans l'ordre où l'écran de la maison les reçoit), ses appareils, ce qui y est allumé, ses lumières. */
const NOMS_ALLUMES = 5;
const lesPieces = lecture((liste, t, _w, _l, { frais, enMarche }) => {
  if (!liste.length) return { etat: 'vide', raison: 'aucun_appareil' };
  const pieces: Array<{ nom: string; appareils: number; allumes: string[]; enPlus: number; lumieres: Array<{ id: string; allume?: boolean; horsLigne?: true }> }> = [];
  const parNom = new Map<string, (typeof pieces)[number]>();
  for (const a of liste) {
    let p = parNom.get(a.piece);
    if (!p) { p = { nom: a.piece, appareils: 0, allumes: [], enPlus: 0, lumieres: [] }; parNom.set(a.piece, p); pieces.push(p); }
    p.appareils++;
    const on = frais(a, t) ? enMarche(a) : undefined;
    // Allumé sans nom : compté (« et N de plus »), jamais nommé par son identifiant brut.
    if (on === true && a.sorte !== 'serrure' && a.sorte !== 'volet' && a.sorte !== 'détecteur' && a.sorte !== 'capteur') { if (p.allumes.length < NOMS_ALLUMES && a.nom) p.allumes.push(a.nom); else p.enPlus++; }
    if (a.sorte === 'lumière' && a.id && a.commandable !== false) p.lumieres.push({ id: a.id, ...(on === undefined ? {} : { allume: on }), ...(a.enLigne === false ? { horsLigne: true as const } : {}) });
  }
  return { etat: 'ok', at: t, donnee: { pieces } };
});

/**
 * « Température » et « Humidité » (les petits chiffres de maison.ts) : une pièce ou un capteur choisi. Le choix réduit les
 * appareils lus à ceux de cette pièce (ou à ce capteur) avant le calcul de la sorte, qui ne change pas ; sans choix, rien
 * ne change (la moyenne dite). Son nettoyage : le titre, et « appareil:<id> » ou « piece:<nom> ». `est` : les capteurs de
 * cette mesure (la règle de maison.ts), pour la liste des choix de « Régler » (les pièces qui en ont, puis ces capteurs),
 * servie au propriétaire seul, sur l'accueil seul.
 */
export const selonLeChoix = (lire: NonNullable<SorteWidget['lire']>, est: (a: AppareilVu) => boolean): NonNullable<SorteWidget['lire']> => async (w, src, l) => {
  const c = cibleDe(w), lu = src.appareilsMaison;
  let tous: readonly AppareilVu[] | undefined;
  const garder = (a: AppareilVu) => (!c || (c.genre === 'piece' ? a.piece === c.valeur : a.id === c.valeur));
  const e = await lire(w, lu ? { ...src, appareilsMaison: async () => { const a = await lu(); if (a && Array.isArray(a.appareils)) { tous = a.appareils; return { ...a, appareils: a.appareils.filter(garder) }; } return a; } } : src, l);
  if (!tous) return e;
  // Un choix qui ne désigne plus rien parmi les appareils lus (le capteur retiré d'Odin, la pièce qui n'a plus d'appareil) :
  // dit tel quel, jamais « aucun capteur dans la maison » quand d'autres existent. Une pièce sans capteur de cette mesure
  // reste « aucun_appareil » (rien à y mesurer).
  const parti = c && !tous.some(garder) ? { etat: 'vide' as const, raison: c.genre === 'piece' ? 'piece_absente' : 'appareil_absent' } : undefined;
  // La liste, seulement si les appareils ont été lus (jamais pour un membre : rien n'est lu pour lui).
  return avecLesChoix(parti ?? e, l, () => choixMesure(tous!, est));
};
export const avecChoix: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => {
  if (o.label) out.label = t.str(o.label, 40);
  const c = cibleNette(o.cible, ['appareil', 'piece'], t.str); if (c) out.cible = c;
  return true;
};

const base = { famille: 'maison', applis: ['midgard'], public: 'maison', posable: true } as const;
/** Le titre (comme les autres) et le choix d'un appareil : seulement « appareil:<id> ». */
const avecAppareil: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => {
  if (o.label) out.label = t.str(o.label, 40);
  const c = cibleNette(o.cible, ['appareil'], t.str); if (c) out.cible = c;
  return true;
};

export const SORTES_MAISON_APPAREILS = [
  // Un appareil, en tuile (la maquette : 3 × 1, 2 × 1 au plus petit) : ici 3 × 2 au plus petit, pour que toutes ses
  // commandes (celles d'une clim : quatre) tiennent en entier.
  { id: 'maison_appareil', ...base, taille: { mini: [3, 2], r: 2 }, styles: ['simple'], nettoyer: avecAppareil, lire: unAppareil(() => true) },
  // Une lumière : allumer, éteindre, son intensité (sans nombre de départ : Odin ne la lit pas).
  { id: 'maison_lumiere', ...base, taille: { mini: [3, 2], r: 2 }, styles: ['simple'], nettoyer: avecAppareil, lire: unAppareil((a) => a.sorte === 'lumière') },
  // Un capteur ou un détecteur : sa valeur, sa pièce, l'âge vrai de la mesure (la courbe : plus tard).
  { id: 'maison_capteur', ...base, taille: { mini: [3, 2], r: 2 }, styles: ['simple'], nettoyer: avecAppareil, lire: unAppareil((a) => a.sorte === 'capteur' || a.sorte === 'détecteur') },
  // Les pièces (la maquette : 3 × 4, 3 × 3 au plus petit), en liste. Le style « Tuiles » est dessiné par la page, mais ne
  // s'ajoute ici qu'avec sa ligne dans la table des styles de « Régler » (pages/widgets-rendu.js : hors de ce lot).
  { id: 'maison_pieces', ...base, taille: { mini: [3, 3], r: 4 }, styles: ['liste'], nettoyer: (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; }, lire: lesPieces },
] as const satisfies readonly SorteWidget[];
