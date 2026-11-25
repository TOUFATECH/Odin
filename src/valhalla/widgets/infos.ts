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
 * La grande météo de la maquette (ses trois styles « complete », « compacte », « scene ») : seulement ce que la source
 * donne et que le widget montre — maintenant (le lieu, la température, le ciel, le haut et le bas du jour), les 7
 * jours, les 24 heures (l'heure et la température : la source n'en dit pas plus), le lever et le coucher — dans les
 * unités d'Odin, avec 12 ou 24 h comme Odin est réglé. Ni position, ni rien d'autre. Ce qui est illisible est laissé
 * (jamais remplacé) ; une température de maintenant illisible : rien.
 */
const STYLES_GRANDS: readonly string[] = ['complete', 'compacte', 'scene'];
const HEURE_LUE = /^([01]\d|2[0-3]):[0-5]\d$/, JOUR_LU = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const lisible = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function grandeMeteo(d: Record<string, unknown>, heure12: boolean): Record<string, unknown> | undefined {
  if (!lisible(d.temp)) return undefined;
  const deg = (v: number) => Math.round(d.unites === 'imperial' ? versF(v) : v), code = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : -1);
  const objets = (v: unknown) => (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object');
  const jours = objets(d.days).filter((j) => typeof j.day === 'string' && JOUR_LU.test(j.day) && lisible(j.hi) && lisible(j.lo)).slice(0, 7)
    .map((j) => ({ jour: j.day, code: code(j.code), max: deg(j.hi as number), min: deg(j.lo as number) }));
  const heures = objets(d.hours).filter((h) => typeof h.t === 'string' && HEURE_LUE.test(h.t) && lisible(h.temp)).slice(0, 24).map((h) => ({ h: h.t, temp: deg(h.temp as number) }));
  const heure = (v: unknown) => (typeof v === 'string' && HEURE_LUE.test(v) ? v : undefined), lever = heure(d.sunrise), coucher = heure(d.sunset);
  return { lieu: typeof d.place === 'string' ? d.place : '', temp: deg(d.temp), code: code(d.code), ...(lisible(d.hi) && lisible(d.lo) ? { max: deg(d.hi), min: deg(d.lo) } : {}),
    heure12, jours, heures, ...(lever ? { lever } : {}), ...(coucher ? { coucher } : {}) };
}

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
    // Le temps qu'il fait au lieu d'Odin (Open-Meteo, lu par Hestia). Quatre styles : « simple » (celui d'hier, sa
    // lecture inchangée) et les trois de la grande météo de la maquette (« complete », « compacte », « scene »), qui
    // lisent la même action et ne rendent que ce qu'ils montrent (grandeMeteo).
    id: 'meteo', famille: 'infos', applis: ['gladsheim'], taille: { mini: [3, 2], r: 3 }, styles: ['simple', ...STYLES_GRANDS], public: 'maison', posable: true,
    nettoyer: etiquette(40),
    lire: async (w, src): Promise<EtatWidget> => {
      // Comme l'heure : tant que le lieu n'est pas réglé, ce serait le temps d'un lieu supposé (et une recherche du lieu
      // par défaut sur Internet). Rien d'affirmé, rien de lu.
      const l = src.lieu();
      if (!l.choisi) return { etat: 'vide', raison: 'lieu_non_choisi' };
      const m = await src.meteo().catch(() => undefined);
      if (!m) return { etat: 'vide', raison: 'meteo_pas_lue' };
      const grande = typeof w.style === 'string' && STYLES_GRANDS.includes(w.style);
      const donnee = grande ? grandeMeteo(m.donnee, l.heure12) : m.donnee;
      if (!donnee) return { etat: 'vide', raison: 'meteo_pas_lue' };
      return m.ancien ? { etat: 'ancien', at: m.at, donnee, motif: m.motif } : { etat: 'ok', at: m.at, donnee };
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
