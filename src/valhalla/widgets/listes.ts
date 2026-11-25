// La famille « Listes d'Odin » des widgets (maquette validée « Accueil ») : son agenda (les prochains rendez-vous de
// Chronos) et ses dernières recherches (Pythie). Les sauvegardes et les pubs bloquées s'y ajouteront.
// Qui voit quoi : l'agenda et les recherches sont au PROPRIÉTAIRE SEUL. Un membre (même avec le droit sur l'appli, même
// si le widget lui était « ouvert »), une tablette « maison » : refusés avant toute lecture (le public de la sorte), et la
// lecture elle-même refuse encore qui n'est pas lui. La route des widgets ne s'ouvre ni à une clé d'accès ni sans session.
// Rien n'est montré tant qu'Odin n'a pas la vraie donnée (sa réponse à la question 13) : zéro rendez-vous, zéro
// recherche, l'état « vide » ; l'appli coupée, « source_absente ». Ces lectures sont celles du moment (des réglages et
// un fichier d'Odin) : elles n'ont pas d'état « ancien ».
import type { EtatWidget, Lecteur, SorteWidget } from './sorte.ts';

/** Le libellé choisi par la personne : 40 signes. */
const etiquette: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; };
/** Les rendez-vous et les recherches servis au plus (les plus proches, les plus récentes) ; le total dit le reste. */
export const LIGNES_SERVIES = 20;
/** Un titre, une question : du texte, borné (la page le coupe à l'écran). */
const TEXTE_MAX = 300;
/** Un identifiant de recherche tel que Pythie les écrit (et que sa page sait rouvrir : /recherche#r=…). */
const ID_RECHERCHE = /^[a-f0-9]{6,20}$/;
const fini = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const texte = (v: unknown) => String(v ?? '').slice(0, TEXTE_MAX);
/** Le propriétaire seul : la même règle que le public de la sorte, redite au moment de lire. */
const pasLui = (l: Lecteur): EtatWidget | undefined => (l?.qui === 'proprietaire' ? undefined : { etat: 'refuse', raison: 'proprietaire_seul' });

export const SORTES_LISTES = [
  {
    // « Agenda » : les prochains rendez-vous de Chronos, le plus proche d'abord. Les heures sont des instants ; la page
    // les écrit dans le fuseau d'Odin (donné ici), sur 12 ou 24 h comme Odin est réglé. Zéro : l'état « vide », que la
    // page dessine avec « Ouvrir Chronos ».
    id: 'agenda', famille: 'listes', applis: ['frigg'], taille: { mini: [3, 2], r: 3 }, styles: ['liste'], posable: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const non = pasLui(l); if (non) return non;
      if (!src.rendezVous) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const r = src.rendezVous();
      if (!r) return { etat: 'source_absente', raison: 'appli_absente' };
      const liste = r.liste.filter((x) => fini(x.debut) && fini(x.fin)).sort((a, b) => a.debut - b.debut);
      if (!liste.length) return { etat: 'vide', raison: 'aucun_rendez_vous' };
      const rendezVous = liste.slice(0, LIGNES_SERVIES).map((x) => ({ titre: texte(x.titre), debut: x.debut, fin: Math.max(x.debut, x.fin), ...(x.attente ? { attente: true } : {}) }));
      return { etat: 'ok', at: src.maintenant(), donnee: { rendezVous, total: liste.length, fuseau: String(r.fuseau ?? ''), heure12: src.lieu().heure12 === true } };
    },
  },
  {
    // « Recherche » : les dernières recherches de Pythie, les plus récentes d'abord. Chacune garde son identifiant si
    // la page de Pythie sait la rouvrir ; sinon elle est montrée sans lien. Zéro : l'état « vide ».
    id: 'recherches', famille: 'listes', applis: ['volva'], taille: { mini: [3, 2], r: 3 }, styles: ['liste'], posable: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const non = pasLui(l); if (non) return non;
      if (!src.recherches) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const l0 = src.recherches();
      if (!l0) return { etat: 'source_absente', raison: 'appli_absente' };
      const liste = l0.filter((x) => typeof x?.q === 'string' && x.q.trim()).sort((a, b) => (fini(b.at) ? b.at : 0) - (fini(a.at) ? a.at : 0));
      if (!liste.length) return { etat: 'vide', raison: 'aucune_recherche' };
      const recherches = liste.slice(0, LIGNES_SERVIES).map((x) => ({ ...(ID_RECHERCHE.test(x.id) ? { id: x.id } : {}), q: texte(x.q), at: fini(x.at) ? x.at : 0 }));
      return { etat: 'ok', at: src.maintenant(), donnee: { recherches, total: liste.length } };
    },
  },
] as const satisfies readonly SorteWidget[];
