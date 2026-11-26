// La famille « Listes d'Odin » des widgets (maquette validée « Accueil ») : son agenda (les prochains rendez-vous de
// Chronos), ses dernières recherches (Pythie), ses sauvegardes (Phénix) et les pubs bloquées (Sphinx).
// Qui voit quoi : les quatre sont au PROPRIÉTAIRE SEUL. Un membre (même avec le droit sur l'appli, même
// si le widget lui était « ouvert »), une tablette « maison » : refusés avant toute lecture (le public de la sorte), et la
// lecture elle-même refuse encore qui n'est pas lui. La route des widgets ne s'ouvre ni à une clé d'accès ni sans session.
// Rien n'est montré tant qu'Odin n'a pas la vraie donnée (sa réponse à la question 13) : zéro rendez-vous, zéro
// recherche, aucun plan de sauvegarde, Sphinx arrêté ou sans question : l'état « vide » ; l'appli coupée,
// « source_absente ». Ces lectures sont celles du moment (des réglages, un fichier, le journal en mémoire de Sphinx) :
// elles n'ont pas d'état « ancien » ; une sauvegarde trop vieille est dite « en retard », avec son heure.
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
/** Un compte : un entier positif ou nul (sinon zéro, qui ne sert qu'à refuser une valeur lue de travers). */
const compte = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0);
/** Les sortes de sauvegarde de Phénix (une autre valeur : « complète », comme Phénix lit une sauvegarde sans sorte). */
const SORTES_SAUVEGARDE: readonly string[] = ['complète', 'incrémentielle', 'différentielle'];
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
  {
    // « Sauvegardes » (la maquette : la dernière sauvegarde et la prochaine) : l'état des sauvegardes de Phénix. Des
    // comptes et des heures : ni nom de plan, ni chemin, ni destination, ni texte d'erreur (etatSauvegardes). Aucun plan
    // réglé : l'état « vide », que la page dessine avec « Ouvrir Phénix ». La page ne dit « tout va bien » qu'avec une
    // sauvegarde réussie mesurée, sans échec, ni retard, ni plan jamais fait (`sansMesure`).
    id: 'sauvegardes', famille: 'listes', applis: ['sindri'], taille: { mini: [3, 2], r: 2 }, styles: ['etat'], posable: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const non = pasLui(l); if (non) return non;
      if (!src.sauvegardes) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const r = src.sauvegardes();
      if (!r) return { etat: 'source_absente', raison: 'appli_absente' };
      if (!(r.plans > 0)) return { etat: 'vide', raison: 'aucune_sauvegarde' };
      const d = r.derniere && fini(r.derniere.at) ? { at: r.derniere.at, type: SORTES_SAUVEGARDE.includes(r.derniere.type) ? r.derniere.type : 'complète', ...(fini(r.derniere.octets) && r.derniere.octets >= 0 ? { octets: r.derniere.octets } : {}) } : undefined;
      return { etat: 'ok', at: src.maintenant(), donnee: {
        plans: r.plans, ...(d ? { derniere: d } : {}), echecs: compte(r.echecs), ...(compte(r.echecs) && fini(r.echecA) ? { echecA: r.echecA } : {}),
        enRetard: compte(r.enRetard), sansMesure: compte(r.sansMesure), ...(fini(r.prochaine) ? { prochaine: r.prochaine } : {}), fuseau: String(r.fuseau ?? ''), heure12: src.lieu().heure12 === true,
      } };
    },
  },
  {
    // « Pubs bloquées » (la maquette : pubs et pisteurs bloqués pour toute la maison) : ce que Sphinx a bloqué aujourd'hui.
    // Des comptes seulement : ni domaine, ni appareil (le détail reste dans la page de Sphinx). Sphinx arrêté, ou aucune
    // question aujourd'hui : l'état « vide » (jamais un zéro à la place d'une absence) ; un zéro mesuré reste un zéro.
    // Propriétaire seul : la page de Sphinx ne montre à un membre que son propre appareil, alors que ces comptes sont
    // ceux de toute la maison.
    id: 'pubs_bloquees', famille: 'listes', applis: ['vidarr'], taille: { mini: [3, 2], r: 2 }, styles: ['anneau'], posable: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const non = pasLui(l); if (non) return non;
      if (!src.blocages) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const r = src.blocages();
      if (!r) return { etat: 'source_absente', raison: 'appli_absente' };
      if (!r.allume) return { etat: 'vide', raison: 'sphinx_arrete' };
      if (!(compte(r.questions) > 0)) return { etat: 'vide', raison: 'aucune_question' };
      const complet = r.complet === true;
      return { etat: 'ok', at: src.maintenant(), donnee: {
        questions: compte(r.questions), bloquees: Math.min(compte(r.bloquees), compte(r.questions)), complet,
        ...(!complet && fini(r.depuis) ? { depuis: r.depuis } : {}), fuseau: String(r.fuseau ?? ''), heure12: src.lieu().heure12 === true,
      } };
    },
  },
] as const satisfies readonly SorteWidget[];
