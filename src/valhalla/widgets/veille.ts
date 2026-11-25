// La famille « Veille » des widgets (maquette validée « Accueil ») : la liste des alertes pas encore vues, et les sites
// surveillés par Arachné (le grand widget « Sites web » et le petit chiffre « combien répondent »). Pulsar reste à côté
// (sa réponse à la question 14 : « Mes sites ») : le widget « site » d'hier, une sonde de Pulsar, ne change pas.
// Qui voit quoi :
// - les alertes se lisent sous l'appli des alertes, qui est de la vie privée : fermées à un membre tant que le
//   propriétaire ne lui a pas ouvert ce widget ; ouvert, il ne voit que les alertes des applis où il a le droit, sans
//   leur identifiant (« vu » reste au propriétaire). Jamais servies à une tablette « maison » (famille hors infos et maison) ;
// - les sites : au propriétaire, et à un membre qui a le droit sur Arachné (leurs noms, s'ils répondent) ; jamais à une
//   tablette. Les actions (« Vérifier », « Essayer », « Relancer ») ne sont proposées qu'au propriétaire, et passent
//   par l'action d'Arachné qui existe : le serveur refuse lui-même un membre sans droit ou une tablette.
// Rien n'est montré tant qu'Odin n'a pas la vraie donnée (sa réponse à la question 13) : zéro site, l'état « vide » ;
// aucun site encore vérifié, pas de chiffre ; une veille qui ne vérifie plus, l'état « ancien » avec son heure.
import type { EtatWidget, Lecteur, SiteVeille, SorteWidget, SourceWidget } from './sorte.ts';

/** Le libellé choisi par la personne : 40 signes. */
const etiquette: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; };
/** Le petit chiffre de la maquette : deux colonnes sur douze, une ligne. */
const PETIT = { mini: [2, 1], r: 1 } as const;
/** Les alertes montrées au plus (les plus récentes). */
export const ALERTES_MONTREES = 20;
/** Une veille est ancienne quand rien n'a été vérifié depuis trois passages du site le moins souvent vérifié (15 min au moins). */
const ancienneApres = (l: readonly SiteVeille[]) => Math.max(15, ...l.map((x) => x.toutesLes * 3)) * 60_000;
/** L'état d'un site, en un code : en panne, lent, en ligne, ou pas encore vérifié. */
const etatSite = (x: SiteVeille) => (x.enLigne === false ? 'panne' : x.enLigne === true ? (x.lent ? 'lent' : 'ok') : 'inconnu');
const RANG: Record<string, number> = { panne: 0, lent: 1, inconnu: 2, ok: 3 };

/**
 * Les sites d'Arachné tels que le widget les montre. Rend un état sans donnée (zéro site, Arachné muette), ou la liste
 * (les pannes d'abord), l'heure de la vérification la plus récente, et si elle est ancienne.
 */
function lireSites(src: SourceWidget, l: Lecteur): EtatWidget | { sites: Array<Record<string, unknown>>; compte: Record<string, number>; at?: number; ancien: boolean } {
  if (!src.sitesVeille) return { etat: 'source_absente', raison: 'pas_encore_lu' };
  const l0 = src.sitesVeille();
  if (!l0) return { etat: 'source_absente', raison: 'appli_absente' };
  if (!l0.length) return { etat: 'vide', raison: 'aucun_site' };
  const lui = l.qui === 'proprietaire', vus = l0.map((x) => x.verifieA).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const at = vus.length ? Math.max(...vus) : undefined;
  const sites = l0.map((x) => ({ x, e: etatSite(x) })).sort((a, b) => RANG[a.e] - RANG[b.e]).map(({ x, e }) => ({
    nom: x.nom, etat: e, ...(typeof x.ms === 'number' && e !== 'panne' && e !== 'inconnu' ? { ms: x.ms } : {}),
    ...(x.verifieA !== undefined ? { verifie: x.verifieA } : {}), ...(e === 'panne' && x.enPanneDepuis !== undefined ? { depuis: x.enPanneDepuis } : {}),
    // « Relancer » n'existe que pour un site relié à Vercel ; il n'est proposé qu'au propriétaire.
    ...(lui && x.relancer ? { relancer: true } : {}),
  }));
  const compte = { total: sites.length, enLigne: sites.filter((x) => x.etat === 'ok' || x.etat === 'lent').length, panne: sites.filter((x) => x.etat === 'panne').length, lents: sites.filter((x) => x.etat === 'lent').length, verifies: vus.length };
  return { sites, compte, at, ancien: at !== undefined && src.maintenant() - at > ancienneApres(l0) };
}

export const SORTES_VEILLE = [
  {
    // La liste des alertes pas encore vues, les plus récentes d'abord : son appli, son texte, son âge. Le petit chiffre
    // « alertes » (famille infos) en dit le nombre ; celui-ci les montre. Zéro : l'état « vide », un état calme.
    id: 'alertes_liste', famille: 'veille', applis: ['forseti'], taille: { mini: [3, 2], r: 3 }, styles: ['liste'], public: 'membre', posable: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      if (!src.alertesAVoir) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const lui = l.qui === 'proprietaire';
      // Un membre à qui le propriétaire a ouvert ce widget : seulement les applis où il a le droit, sans identifiant.
      const toutes = src.alertesAVoir().filter((a) => lui || l.peutLire?.(a.appli) === true);
      if (!toutes.length) return { etat: 'vide', raison: 'aucune_alerte' };
      const alertes = [...toutes].sort((a, b) => b.at - a.at).slice(0, ALERTES_MONTREES)
        .map((a) => ({ ...(lui ? { id: a.id } : {}), appli: a.appli, nomAppli: a.nomAppli, titre: a.titre, niveau: a.niveau, at: a.at }));
      // Les comptes par gravité de la maquette (sa barre, « N grave · N à surveiller »), sur toutes celles qu'il peut voir.
      // « Réglée » n'est pas compté : une alerte vue n'est plus lue ici (question 13 : pas de chiffre sans source).
      const graves = toutes.filter((a) => a.niveau === 'critique' || a.niveau === 'haute').length, aSurveiller = toutes.filter((a) => a.niveau === 'moyenne').length;
      return { etat: 'ok', at: src.maintenant(), donnee: { alertes, total: toutes.length, graves, aSurveiller, agir: lui } };
    },
  },
  {
    // « Sites web » : les sites surveillés par Arachné (son nom, s'il répond, depuis quand, son temps de réponse), les
    // pannes d'abord. Le style de départ de la maquette, « apercus », avec une miniature neutre (aucun aperçu en image
    // n'existe). Zéro site : l'état « vide », que la page dessine avec « Ajouter un site ».
    id: 'sites', famille: 'veille', applis: ['idunn'], taille: { mini: [3, 2], r: 5 }, styles: ['apercus'], public: 'membre', posable: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const r = lireSites(src, l);
      if ('etat' in r) return r;
      const donnee = { sites: r.sites, ...r.compte, agir: l.qui === 'proprietaire' };
      return r.ancien && r.at !== undefined ? { etat: 'ancien', at: r.at, donnee, motif: 'veille_arretee' } : { etat: 'ok', at: r.at ?? src.maintenant(), donnee };
    },
  },
  {
    // Le petit chiffre « Sites » : combien de sites répondent, sur combien. Aucun site vérifié : pas de chiffre.
    id: 'sites_petit', famille: 'veille', applis: ['idunn'], taille: PETIT, styles: ['simple'], public: 'membre', posable: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const r = lireSites(src, l);
      if ('etat' in r) return r;
      if (!r.compte.verifies || r.at === undefined) return { etat: 'vide', raison: 'sites_pas_verifies' };
      const donnee = { enLigne: r.compte.enLigne, total: r.compte.total, panne: r.compte.panne };
      return r.ancien ? { etat: 'ancien', at: r.at, donnee, motif: 'veille_arretee' } : { etat: 'ok', at: r.at, donnee };
    },
  },
] as const satisfies readonly SorteWidget[];
