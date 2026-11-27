// La famille « Maison » des widgets, ses courbes (maquette validée « Accueil ») : « Consommation du jour » et « Énergie
// de la semaine », et la courbe du widget « Capteur » (maison-appareils.ts). Rangées dans ce fichier pour ne pas écrire
// dans ceux des autres parts de la famille ; la famille est la même. Sa réponse du 25/11 : pas de page Énergie, les
// courbes vont dans les widgets ; ce qui n'a pas de source est caché (ni faux chiffre, ni zéro à la place d'une absence).
// - Tout vient des relevés gardés dans le magasin de mesures (appareils.ts, garderReleve) : rien n'est mesuré ici, rien
//   n'y est écrit. Les séries « appareils. » disent quand la maison vit : elles ne sont lues qu'avec { prive: true }, et
//   seulement pour le propriétaire sur son accueil (`lui`). Un membre, une tablette « maison », une clé « complet » au
//   mur, une requête sans session : refusés AVANT toute lecture du magasin. Les deux sortes sont « propriétaire seul »
//   (le public par défaut) et portent la marque « jamais sur l'écran de la maison ».
// - Les prises qui mesurent : la règle du petit chiffre « Watts » (maison.ts, surUnePrise) — un capteur qui partage un
//   lien (un sujet d'état, un module Tasmota) avec une prise ; un compteur général n'en est pas une. Leur énergie (kWh,
//   Wh) donne les totaux, par la fonction qui existe (appareils.ts, energieDuJour : le jour au FUSEAU D'ODIN) ; leur
//   puissance (W, kW) donne la courbe de la journée. Aucune part « par usage » (Odin ne connaît pas l'usage d'une prise),
//   aucune comparaison avec la veille.
// - Une absence reste une absence : un jour sans relevé n'a pas de valeur, une demi-heure où une prise n'a rien dit est
//   un trou de la courbe, une coupure longue dans les relevés d'un capteur coupe sa courbe. Rien n'est prolongé.
// - Le coût : une lecture par série et par fenêtre, une seule fois par demande (dix widgets lisent une fois : l'instant
//   de la demande est figé à sa première lecture, pour tous ses widgets) ; les jours
//   finis de la semaine sont calculés une fois puis gardés en mémoire (des nombres, jamais rendus avec leur série) ;
//   au plus PTS_MAX points par courbe servie.
import type { Metrics } from '../metrics.ts';
import { energieDuJour, nomSerie, releve, type Device, type MesureReleve } from '../modules/appareils.ts';
import type { Widget } from '../modules/gladsheim.ts';
import type { AppareilVu, EtatWidget, Lecteur, RelevesMaison, SorteWidget, SourceWidget } from './sorte.ts';

const MIN = 60_000, H = 3_600_000, J = 86_400_000;
/** Le propriétaire, sur son accueil : le seul pour qui un relevé gardé est lu. */
export const lui = (l: Lecteur) => l.qui === 'proprietaire' && l.ecran === 'accueil';

// ---------------------------------------------------------------- Le jour et l'heure au fuseau d'Odin
const FORMATS = new Map<string, Intl.DateTimeFormat>();
function format(fz: string): Intl.DateTimeFormat | undefined {
  let f = FORMATS.get(fz);
  if (!f) { try { f = new Intl.DateTimeFormat('en-CA', { timeZone: fz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return undefined; } FORMATS.set(fz, f); }
  return f;
}
/** Le jour (« AAAA-MM-JJ ») et la minute du jour d'un instant, au fuseau donné. */
export function localDe(t: number, fz: string): { jour: string; minute: number } | undefined {
  const f = format(fz); if (!f || !Number.isFinite(t)) return undefined;
  const p: Record<string, string> = {}; for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value;
  return { jour: `${p.year}-${p.month}-${p.day}`, minute: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
/** Le jour `n` jours après `jour` (calendrier, sans fuseau). */
export const jourPlus = (jour: string, n: number) => new Date(Date.parse(`${jour}T00:00:00Z`) + n * J).toISOString().slice(0, 10);
/**
 * La fenêtre des instants qui peuvent tomber dans ce jour, quel que soit le fuseau (de -12 h à +14 h), plus le quart
 * d'heure d'avant minuit que compte energieDuJour : large, puis chaque calcul garde ses seuls points du jour.
 */
const fenetreDu = (jour: string, a: number) => ({ de: Date.parse(`${jour}T00:00:00Z`) - 15 * H, a: Math.min(a, Date.parse(`${jour}T00:00:00Z`) + 37 * H) });

// ---------------------------------------------------------------- La lecture bornée des relevés (pour source.ts)
/** Les jours finis de la semaine, gardés par magasin : « série|jour|fuseau » → l'énergie du jour (null : pas de donnée) et s'il est incomplet. */
const JOURS_FAITS = new WeakMap<object, Map<string, { v: number | null; inc: boolean }>>();
const JOURS_MAX = 5000;
/** Le pont de minuit d'energieDuJour (15 minutes) : un jour dont aucun relevé ne tombe à moins de 15 minutes de minuit est incomplet. */
const PONT = 15;
/**
 * La lecture des relevés de la maison, une par demande (la source d'une page) : chaque série n'est lue qu'une fois par
 * fenêtre ; ni le nom d'une série ni l'empreinte d'un identifiant ne sortent d'ici. `{ prive: true }` : ce qui ne
 * s'appelle que pour le propriétaire (la règle `lui`, dans chaque lecture de ce fichier, avant d'appeler).
 * L'instant de la demande est figé à la création (`instant`) : aucune fenêtre ne finit après lui, si bien que les
 * widgets suivants d'une même demande retrouvent une fenêtre déjà lue, même quand l'horloge avance entre eux.
 */
export function lectureReleves(m: Pick<Metrics, 'points'>, fuseau: string, maintenant: () => number): RelevesMaison {
  const t0 = maintenant();
  const vus = new Map<string, ReadonlyArray<readonly [number, number]>>();
  const faits = JOURS_FAITS.get(m) ?? new Map<string, { v: number | null; inc: boolean }>(); JOURS_FAITS.set(m, faits);
  const fenetres = new Map<string, Array<{ de: number; a: number; p: ReadonlyArray<readonly [number, number]> }>>();
  const lus = (serie: string, de: number, a0: number) => {
    const a = Math.min(a0, t0), k = `${serie}|${de}|${a}`; let p = vus.get(k);
    if (p) return p;
    if (!(de < a)) return [];
    // Une fenêtre déjà lue de cette série qui contient celle-ci : ses points, sans relire le magasin.
    const large = fenetres.get(serie)?.find((f) => f.de <= de && f.a >= a);
    p = large ? large.p.filter((x) => x[0] >= de && x[0] <= a) : m.points(serie, de, a, { prive: true });
    vus.set(k, p); if (!large) fenetres.set(serie, [...(fenetres.get(serie) ?? []), { de, a, p }]);
    return p;
  };
  /** L'énergie et l'incomplétude de chacun des jours donnés (les jours finis : calculés une fois, gardés). */
  const parJour = (id: string, jours: readonly string[]): Array<{ v: number | undefined; inc: boolean }> => {
    const n = nomSerie(id, 'energie'), rien = () => jours.map(() => ({ v: undefined, inc: false }));
    if (!n || !jours.length) return rien();
    const ici = localDe(t0, fuseau); if (!ici) return rien();
    // Un jour fini depuis plus de 5 minutes ne change plus : calculé une fois, gardé.
    const fini = (j: string) => j < ici.jour && (j < jourPlus(ici.jour, -1) || ici.minute >= 5);
    const cle = (j: string) => `${n}|${j}|${fuseau}`;
    const manque = jours.filter((j) => !(fini(j) && faits.has(cle(j))));
    let pts: ReadonlyArray<readonly [number, number]> = [];
    if (manque.length) { const premier = manque.reduce((x, y) => (y < x ? y : x)); pts = lus(n, fenetreDu(premier, t0).de, t0); }
    const locaux = manque.length ? pts.map((p) => localDe(p[0], fuseau)) : [];
    return jours.map((j) => {
      if (fini(j) && faits.has(cle(j))) { const f = faits.get(cle(j))!; return { v: f.v === null ? undefined : f.v, inc: f.inc }; }
      const v = energieDuJour(pts as [number, number][], j, fuseau), veille = jourPlus(j, -1);
      // Couvert depuis minuit : un relevé dans le premier quart d'heure du jour, ou dans le dernier de la veille.
      const inc = v !== undefined && !locaux.some((x) => x && ((x.jour === j && x.minute <= PONT) || (x.jour === veille && x.minute >= 1440 - PONT)));
      if (fini(j)) { if (faits.size >= JOURS_MAX) faits.clear(); faits.set(cle(j), { v: v === undefined ? null : v, inc }); }
      return { v, inc };
    });
  };
  return {
    fuseau,
    instant: t0,
    points: (id, mesure, de, a) => { const n = nomSerie(id, mesure); return n && Number.isFinite(de) && Number.isFinite(a) && de < a ? lus(n, de, a) : []; },
    energies: (id, jours) => parJour(id, jours).map((x) => x.v),
    incomplets: (id, jours) => parJour(id, jours).map((x) => x.inc),
  };
}

// ---------------------------------------------------------------- Les prises qui mesurent
/** La règle du petit chiffre « Watts » (maison.ts, surUnePrise) : un capteur qui partage un lien avec une prise. */
const surUnePrise = (a: AppareilVu, liste: readonly AppareilVu[]) => Boolean(a.liens?.length) && liste.some((p) => p.sorte === 'prise' && p.liens?.some((l) => a.liens!.includes(l)));
/** La mesure qu'un relevé de ce capteur range (la règle de appareils.ts, releve), et le facteur vers la série rangée. */
export function mesureDe(a: Pick<AppareilVu, 'sorte' | 'unite'>): { mesure: MesureReleve; facteur: number } | undefined {
  const r = releve({ kind: a.sorte, unit: a.unite || undefined } as unknown as Device, '1');
  return r ? { mesure: r.mesure, facteur: r.valeur } : undefined;
}
const prisesQui = (liste: readonly AppareilVu[], m: MesureReleve) => liste.filter((a) => a.id && a.sorte === 'capteur' && mesureDe(a)?.mesure === m && surUnePrise(a, liste));
const arrondi = (v: number, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

/** La lecture commune des deux sortes : lui seul, AVANT toute lecture ; les appareils de Midgard ; le magasin. */
const lecture = (calcul: (liste: readonly AppareilVu[], r: RelevesMaison, t: number) => EtatWidget) => async (_w: Widget, src: SourceWidget, l: Lecteur): Promise<EtatWidget> => {
  if (!lui(l)) return { etat: 'refuse', raison: 'proprietaire_seul' };
  if (!src.appareilsMaison || !src.relevesMaison) return { etat: 'source_absente', raison: 'pas_encore_lu' };
  const a = await src.appareilsMaison();
  if (!a || !Array.isArray(a.appareils)) return { etat: 'source_absente', raison: 'appli_muette' };
  if (!prisesQui(a.appareils, 'energie').length && !prisesQui(a.appareils, 'puissance').length) return { etat: 'vide', raison: 'aucune_prise' };
  const r = src.relevesMaison();
  if (!r) return { etat: 'source_absente', raison: 'magasin_absent' };
  // L'instant figé de la demande (le même pour tous ses widgets), pas une nouvelle lecture de l'horloge.
  return calcul(a.appareils, r, r.instant);
};

// ---------------------------------------------------------------- « Consommation du jour »
/** La courbe de la journée : une valeur par demi-heure du jour d'Odin (48), la puissance des prises, en W. */
const PAS_JOUR = 30;
/**
 * La consommation du jour au fuseau d'Odin : le total (kWh, la somme des prises dont energieDuJour rend une valeur ;
 * `prises` : combien ; `incomplet` : les relevés d'une prise comptée ne commencent pas à minuit), et la courbe de la puissance de ses prises, demi-heure par demi-heure. Une demi-heure n'a de
 * valeur que si CHAQUE prise comptée y a au moins un relevé (sinon, un trou : une somme partielle mentirait) ; la
 * demi-heure en cours n'est pas encore une valeur. Moins de deux valeurs : pas de courbe. Rien du tout : « vide ».
 */
export function calculJour(liste: readonly AppareilVu[], r: RelevesMaison, t: number): EtatWidget {
  const ici = localDe(t, r.fuseau); if (!ici) return { etat: 'source_absente', raison: 'fuseau_illisible' };
  const jour = ici.jour, f = fenetreDu(jour, t);
  let total = 0, comptees = 0;
  let incomplet = false;
  for (const a of prisesQui(liste, 'energie')) { const [v] = r.energies(a.id!, [jour]); if (v !== undefined) { total += v; comptees++; if (r.incomplets(a.id!, [jour])[0]) incomplet = true; } }
  // La puissance : par prise, la moyenne de ses relevés dans chaque demi-heure du jour.
  const slots = Math.ceil(1440 / PAS_JOUR), courant = Math.floor(ici.minute / PAS_JOUR);
  const parPrise: Array<Array<number | undefined>> = [];
  for (const a of prisesQui(liste, 'puissance')) {
    const somme = new Array<number>(slots).fill(0), n = new Array<number>(slots).fill(0);
    let vu = false;
    for (const [tp, v] of r.points(a.id!, 'puissance', f.de, t)) { const x = localDe(tp, r.fuseau); if (!x || x.jour !== jour) continue; const s = Math.floor(x.minute / PAS_JOUR); somme[s] += v; n[s]++; vu = true; }
    if (vu) parPrise.push(somme.map((x, i) => (n[i] ? x / n[i] : undefined)));
  }
  const valeurs: Array<number | null> = [];
  for (let s = 0; s < slots; s++) {
    if (s >= courant || !parPrise.length || parPrise.some((p) => p[s] === undefined)) { valeurs.push(null); continue; }
    valeurs.push(arrondi(parPrise.reduce((x, p) => x + p[s]!, 0), 1));
  }
  const courbe = valeurs.filter((x) => x !== null).length >= 2 ? { pas: PAS_JOUR, valeurs, prises: parPrise.length } : undefined;
  if (!comptees && !courbe) return { etat: 'vide', raison: 'pas_encore_de_releve' };
  return { etat: 'ok', at: t, donnee: { jour, ...(comptees ? { total: { kwh: arrondi(total), prises: comptees, ...(incomplet ? { incomplet: true } : {}) } } : {}), ...(courbe ? { courbe } : {}) } };
}

// ---------------------------------------------------------------- « Énergie de la semaine »
/**
 * La consommation jour par jour sur les 7 jours d'Odin qui finissent aujourd'hui (aujourd'hui : jusqu'à maintenant).
 * Un jour sans relevé n'a pas de valeur (ni zéro) ; seuls les jours à partir du premier jour connu sont rendus ;
 * `complet` : les 7 jours ont une valeur. `prises` : combien de prises ont donné au moins un jour. `incomplet` sur un
 * jour : sa valeur est vraie mais ne couvre pas tout le jour (relevés commencés après minuit, ou une prise muette ce jour).
 */
export function calculSemaine(liste: readonly AppareilVu[], r: RelevesMaison, t: number): EtatWidget {
  const ici = localDe(t, r.fuseau); if (!ici) return { etat: 'source_absente', raison: 'fuseau_illisible' };
  const jours = Array.from({ length: 7 }, (_, i) => jourPlus(ici.jour, i - 6));
  const sommes: Array<number | undefined> = jours.map(() => undefined), incomplets = jours.map(() => false);
  let prises = 0;
  const parPrise: Array<Array<number | undefined>> = [];
  for (const a of prisesQui(liste, 'energie')) {
    const e = r.energies(a.id!, jours), inc = r.incomplets(a.id!, jours); let a1 = false;
    e.forEach((v, i) => { if (v !== undefined) { sommes[i] = (sommes[i] ?? 0) + v; a1 = true; if (inc[i]) incomplets[i] = true; } });
    if (a1) { prises++; parPrise.push(e); }
  }
  // Un jour où une prise comptée dans la semaine n'a rien relevé : sa somme ne couvre pas toutes les prises, il est incomplet.
  jours.forEach((_, i) => { if (sommes[i] !== undefined && parPrise.some((e) => e[i] === undefined)) incomplets[i] = true; });
  const premier = sommes.findIndex((x) => x !== undefined);
  if (premier < 0) return { etat: 'vide', raison: 'pas_encore_de_releve' };
  return { etat: 'ok', at: t, donnee: {
    jours: jours.slice(premier).map((j, i) => ({ jour: j, ...(sommes[premier + i] !== undefined ? { kwh: arrondi(sommes[premier + i]!), ...(incomplets[premier + i] ? { incomplet: true } : {}) } : {}) })),
    complet: sommes.every((x) => x !== undefined), prises } };
}

// ---------------------------------------------------------------- La courbe d'un capteur (pour maison-appareils.ts)
/** La fenêtre de la courbe d'un capteur : ses dernières 24 heures. */
export const FENETRE_CAPTEUR = 24 * H;
/** Au plus tant de points servis par courbe (au-delà : une moyenne par quart d'heure). */
export const PTS_MAX = 96;
/**
 * La courbe d'un capteur sur ses dernières 24 heures, dans l'unité de sa valeur montrée (la série range W et kWh : le
 * facteur est retiré). Une coupure de plus de 15 minutes, ou de plus de trois fois le pas habituel de ses relevés, coupe
 * la courbe en morceaux (rien n'est relié par-dessus). Plus de PTS_MAX points : une moyenne par quart d'heure, dans
 * chaque morceau. Moins de deux points : rien (pas de courbe vide). `min`, `max`, `derniere` : ses vrais relevés.
 */
export function courbeCapteur(a: Pick<AppareilVu, 'id' | 'sorte' | 'unite'>, r: RelevesMaison, t: number): Record<string, unknown> | undefined {
  const m = a.id ? mesureDe(a) : undefined; if (!m) return undefined;
  const de = t - FENETRE_CAPTEUR, pts = r.points(a.id!, m.mesure, de, t).filter((p) => p[0] >= de && p[0] <= t && Number.isFinite(p[1])).map(([x, v]) => [x, v / m.facteur] as [number, number]);
  if (pts.length < 2) return undefined;
  const pas = pts.slice(1).map((p, i) => p[0] - pts[i][0]).sort((x, y) => x - y), median = pas[Math.floor(pas.length / 2)];
  const coupure = Math.max(15 * MIN, 3 * median);
  const morceaux: Array<Array<[number, number]>> = [[]];
  for (let i = 0; i < pts.length; i++) { if (i && pts[i][0] - pts[i - 1][0] > coupure) morceaux.push([]); morceaux[morceaux.length - 1].push(pts[i]); }
  const reduits = pts.length <= PTS_MAX ? morceaux : morceaux.map((mo) => {
    const q = new Map<number, number[]>(); for (const [x, v] of mo) { const b = Math.floor(x / (15 * MIN)) * 15 * MIN; const l = q.get(b) ?? []; l.push(v); q.set(b, l); }
    return [...q].map(([b, l]) => [b + 7.5 * MIN, l.reduce((x, y) => x + y, 0) / l.length] as [number, number]);
  });
  const vals = pts.map((p) => p[1]);
  return { de, a: t, morceaux: reduits.map((mo) => mo.map(([x, v]) => [x, arrondi(v)])), min: arrondi(Math.min(...vals)), max: arrondi(Math.max(...vals)), derniere: [pts[pts.length - 1][0], arrondi(vals[vals.length - 1])] };
}

/**
 * Le widget « Capteur » avec sa courbe (maison-appareils.ts) : son état tel qu'il est, plus `courbe` pour le propriétaire
 * sur son accueil seulement, quand le magasin a au moins deux relevés de ce capteur dans la fenêtre. Pour tout autre
 * lecteur, l'état est rendu tel quel, sans que les relevés soient demandés.
 */
export const avecCourbe = (lire: NonNullable<SorteWidget['lire']>): NonNullable<SorteWidget['lire']> => async (w, src, l) => {
  const e = await lire(w, src, l);
  if (e.etat !== 'ok' || !lui(l) || !src.relevesMaison || !src.appareilsMaison) return e;
  const liste = (await src.appareilsMaison())?.appareils, a = Array.isArray(liste) ? liste.find((x) => x.id && x.id === e.donnee.id) : undefined;
  const r = a ? src.relevesMaison() : undefined, c = a && r ? courbeCapteur(a, r, r.instant) : undefined;
  return c ? Object.assign({}, e, { donnee: { ...e.donnee, courbe: c } }) : e;
};

const base = { famille: 'maison', applis: ['midgard'], styles: ['simple'], posable: true, jamaisALaMaison: true } as const;
const etiquette: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; };

export const SORTES_MAISON_COURBES = [
  // « Consommation du jour » (la maquette : 4 × 3, 3 × 2 au moins) : le total du jour et la courbe de la journée.
  { id: 'maison_conso_jour', ...base, taille: { mini: [3, 2], r: 3 }, nettoyer: etiquette, lire: lecture(calculJour) },
  // « Énergie de la semaine » (la maquette : 5 × 3, 4 × 3 au moins) : la consommation jour par jour, en barres.
  { id: 'maison_energie_semaine', ...base, taille: { mini: [4, 3], r: 3 }, nettoyer: etiquette, lire: lecture(calculSemaine) },
] as const satisfies readonly SorteWidget[];
