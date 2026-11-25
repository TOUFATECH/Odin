// La famille « Infos » des widgets : l'heure, la météo, un site surveillé. Une tablette « maison » peut les recevoir.
// Avec les widgets « Infos » de la maquette validée : l'horloge (l'heure en grand, la date, la semaine) est un STYLE de
// la sorte « heure » (la même carte, la même lecture : pas de sorte jumelle) ; les trois petits chiffres (l'heure, la
// météo, les alertes pas encore vues) sont des sortes, parce qu'un petit chiffre a sa propre taille (2 × 1) et que le
// socle garde une taille par sorte. L'heure et la météo en petit suivent la règle de « heure » et de « meteo ». Les
// alertes se lisent sous l'appli des alertes, qui est de la vie privée : fermées à un membre tant que le propriétaire
// ne lui a pas ouvert ce widget, jamais servies à une tablette « maison ».
import { versF } from '../lieu.ts';
import type { EtatWidget, SorteWidget, SourceWidget } from './sorte.ts';

/** Le libellé choisi par la personne : 40 signes (60 pour un site, nommé comme sa sonde). */
const etiquette = (n: number): NonNullable<SorteWidget['nettoyer']> => (o, out, t) => { if (o.label) out.label = t.str(o.label, n); return true; };
/** Le petit chiffre de la maquette : deux colonnes sur douze, une ligne. */
const PETIT = { mini: [2, 1], r: 1 } as const;

/**
 * Le lieu d'Odin, son fuseau, l'heure sur 12 ou 24 h : ce qu'il faut à la page pour donner l'heure d'Odin. Aucune
 * heure n'est calculée ici. `fuseauExige` : sans fuseau connu, rien d'affirmé (la page montrerait l'heure de l'appareil).
 */
function heureDOdin(src: Pick<SourceWidget, 'lieu' | 'maintenant'>, fuseauExige: boolean): EtatWidget {
  const l = src.lieu();
  // Tant que le lieu n'est pas réglé, l'heure serait celle d'un lieu supposé : rien d'affirmé.
  if (!l.choisi) return { etat: 'vide', raison: 'lieu_non_choisi' };
  if (fuseauExige && !l.fuseau) return { etat: 'vide', raison: 'fuseau_inconnu' };
  return { etat: 'ok', at: src.maintenant(), donnee: { lieu: l.nom, fuseau: l.fuseau, heure12: l.heure12 } };
}

export const SORTES_INFOS = [
  {
    // La date, l'heure et le lieu d'Odin (son fuseau). Pas d'appli derrière : le lieu est gardé par Hestia.
    // Deux styles : « simple » (celui d'hier, inchangé) et « horloge » (la maquette : l'heure en grand, la date, la
    // semaine), qui ne se dessine que dans le fuseau d'Odin.
    id: 'heure', famille: 'infos', applis: ['gladsheim'], taille: { mini: [2, 1], r: 2 }, styles: ['simple', 'horloge'], public: 'maison', posable: true,
    nettoyer: etiquette(40),
    lire: async (w, src): Promise<EtatWidget> => heureDOdin(src, w.style === 'horloge'),
  },
  {
    // Le temps qu'il fait au lieu d'Odin (Open-Meteo, lu par Hestia).
    id: 'meteo', famille: 'infos', applis: ['gladsheim'], taille: { mini: [3, 2], r: 3 }, styles: ['simple'], public: 'maison', posable: true,
    nettoyer: etiquette(40),
    lire: async (_w, src): Promise<EtatWidget> => {
      // Comme l'heure : tant que le lieu n'est pas réglé, ce serait le temps d'un lieu supposé (et une recherche du lieu
      // par défaut sur Internet). Rien d'affirmé, rien de lu.
      if (!src.lieu().choisi) return { etat: 'vide', raison: 'lieu_non_choisi' };
      const m = await src.meteo().catch(() => undefined);
      if (!m) return { etat: 'vide', raison: 'meteo_pas_lue' };
      return m.ancien ? { etat: 'ancien', at: m.at, donnee: m.donnee, motif: m.motif } : { etat: 'ok', at: m.at, donnee: m.donnee };
    },
  },
  {
    // Un site surveillé = une sonde de Pulsar, nommée par `label`. Son adresse n'est donnée qu'au propriétaire.
    // L'appli est gardée dans le widget (`module`), et ce ne peut être que Pulsar.
    id: 'site', famille: 'infos', applis: 'choisie', taille: { mini: [2, 1], r: 2 }, styles: ['simple'], public: 'maison', posable: true,
    nettoyer: (o, out, t) => { if (out.module !== 'vordr' || !t.str(o.label, 60)) return false; out.label = t.str(o.label, 60); return true; },
    lire: async (w, src, l): Promise<EtatWidget> => {
      // Les droits ont été vérifiés sur l'appli du widget : on ne lit Pulsar que si c'est bien elle (jamais une autre).
      if (w.module !== 'vordr' || !src.appli('vordr')) return { etat: 'source_absente', raison: 'appli_absente' };
      if (!w.label) return { etat: 'vide', raison: 'site_non_choisi' };
      const vw = await src.vue('vordr');
      if (!vw) return { etat: 'source_absente', raison: 'appli_muette' };
      // La lecture d'aujourd'hui (celle de l'écran de la maison) : la table « Sondes » de Pulsar, par colonnes.
      const tb = vw.sections.find((x) => x.kind === 'table' && x.title === 'Sondes') as { rows?: Array<{ cells: string[]; tone?: string }> } | undefined;
      const r = tb?.rows?.find((x) => x.cells[0] === w.label);
      if (!r) return { etat: 'vide', raison: 'site_introuvable' };
      return { etat: 'ok', at: src.maintenant(), donnee: { etat: r.cells[3] ?? '', jour: r.cells[4] ?? '', mois: r.cells[5] ?? '', temps: r.cells[6] ?? '', ...(l.qui === 'proprietaire' ? { cible: r.cells[2] ?? '' } : {}), ...(r.tone ? { tone: r.tone } : {}) } };
    },
  },
  {
    // L'heure d'Odin en petit chiffre : la lecture de « heure », toujours dans le fuseau d'Odin.
    id: 'heure_petite', famille: 'infos', applis: ['gladsheim'], taille: PETIT, styles: ['simple'], public: 'maison', posable: true,
    nettoyer: etiquette(40),
    lire: async (_w, src): Promise<EtatWidget> => heureDOdin(src, true),
  },
  {
    // La météo du lieu d'Odin en petit chiffre : la lecture de « meteo », réduite à ce que le chiffre montre (le lieu,
    // la température dans les unités d'Odin, le code du ciel). Une température illisible : rien d'affirmé.
    id: 'meteo_petite', famille: 'infos', applis: ['gladsheim'], taille: PETIT, styles: ['simple'], public: 'maison', posable: true,
    nettoyer: etiquette(40),
    lire: async (_w, src): Promise<EtatWidget> => {
      if (!src.lieu().choisi) return { etat: 'vide', raison: 'lieu_non_choisi' };
      const m = await src.meteo().catch(() => undefined);
      const d = (m?.donnee ?? {}) as { place?: unknown; temp?: unknown; code?: unknown; unites?: unknown };
      if (!m || typeof d.temp !== 'number' || !Number.isFinite(d.temp)) return { etat: 'vide', raison: 'meteo_pas_lue' };
      const donnee = { lieu: typeof d.place === 'string' ? d.place : '', temp: d.unites === 'imperial' ? versF(d.temp) : d.temp, code: typeof d.code === 'number' && Number.isInteger(d.code) ? d.code : -1 };
      return m.ancien ? { etat: 'ancien', at: m.at, donnee, motif: m.motif } : { etat: 'ok', at: m.at, donnee };
    },
  },
  {
    // Le nombre d'alertes pas encore vues (« vu » : ack), toutes applis confondues, tel que Valhalla le garde. Il se
    // lit sous l'appli des alertes (vie privée). Un membre à qui le propriétaire a ouvert ce widget ne compte que les
    // alertes des applis où il a le droit (la règle des alertes d'aujourd'hui). Zéro : l'état « vide », sans chiffre.
    id: 'alertes', famille: 'infos', applis: ['forseti'], taille: PETIT, styles: ['simple'], public: 'membre', posable: true,
    nettoyer: etiquette(40),
    lire: async (_w, src, l): Promise<EtatWidget> => {
      if (!src.alertesNonVues) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const toutes = src.alertesNonVues();
      const nombre = l.qui === 'proprietaire' ? toutes.length : toutes.filter((a) => l.peutLire?.(a.appli) === true).length;
      return nombre > 0 ? { etat: 'ok', at: src.maintenant(), donnee: { nombre } } : { etat: 'vide', raison: 'aucune_alerte' };
    },
  },
] as const satisfies readonly SorteWidget[];
