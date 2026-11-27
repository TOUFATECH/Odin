// Le widget « Odin » de l'accueil (maquette validée « Accueil », le widget d'Odin) : le visage d'Odin, ce qu'il dit
// maintenant et sa proposition du moment. Une sorte, « parole », de la famille « odin » (rangée dans « Odin » du tiroir).
//
// La phrase et ses boutons viennent du SEUL moteur de parole d'Odin (src/valhalla/parole.ts), jamais d'ici : rien n'est
// écrit, complété ni inventé par le widget. Le moteur part de ce qui est vrai maintenant et garde un carnet (60 jours,
// par personne) de tout ce qu'il a dit : une phrase donnée est écartée. Le widget lui demande donc une phrase comme
// la mascotte quand elle parle toute seule (« spontane ») : seulement ce qui est neuf et utile, jamais le mode d'emploi ;
// rien de neuf → il se tait, et cette demande-là ne note rien au carnet.
//
// LE CARNET N'AVANCE PAS TOUT SEUL. Un widget redessiné, une grille rafraîchie chaque minute, deux écrans ouverts : si
// chacun redemandait une phrase, Odin serait vidé de ses phrases en une journée et se tairait partout (la mascotte,
// « Que veux-tu ? »). La règle, tenue ici côté serveur (donc commune à tous les écrans du propriétaire) :
//   - une phrase donnée par le moteur est GARDÉE et resservie telle quelle, à chaque lecture, sur chaque écran ;
//   - elle n'est remplacée que si elle a au moins PHRASE_GARDEE ET que personne n'a lu le widget depuis ABSENCE (il est
//     parti, puis revenu), ou, de toute façon, quand elle a PHRASE_PLAFOND : une page vue sans arrêt (un écran au mur)
//     change de phrase au plus toutes les trois heures, et une phrase vieille (une alerte réglée depuis) ne reste pas
//     affichée comme actuelle. La grille ne relit pas une page cachée : une nuit écran éteint ne coûte qu'une demande ;
//   - quand le moteur s'est tu, ou n'a pas répondu, il est redemandé au plus toutes les SILENCE_RELU : une demande sans
//     rien de neuf ne note rien au carnet ; la première chose neuve est alors gardée comme ci-dessus ;
//   - la phrase est datée de sa demande (pas de sa lecture) ;
//   - deux lectures en même temps attendent la même demande (une seule part).
// Le moteur n'a pas de lecture « sans noter » : cette règle en tient lieu, sans le modifier.
//
// Qui voit quoi : la phrase parle des alertes, des tâches, des notes et de la mémoire du propriétaire. Propriétaire seul
// (public par défaut) : la règle commune (droitDeVoir) refuse un membre et une tablette AVANT toute lecture, donc avant
// le moteur ; la route des widgets ne sert ni la clé d'accès ni une requête sans session. Marque « jamais sur l'écran
// de la maison » (un écran au mur, vu par les invités). Et seulement sur l'accueil.
import type { Demande, Parole } from '../parole.ts';
import type { EtatWidget, SorteWidget } from './sorte.ts';

/** Une phrase donnée reste au moins tout ce temps (ms). */
export const PHRASE_GARDEE = 30 * 60_000;
/** Personne n'a lu le widget depuis tout ce temps (ms) : il est parti, puis revenu. */
export const ABSENCE = 15 * 60_000;
/** Le moteur s'est tu, ou n'a pas répondu : redemandé au plus tous les combien (ms). */
export const SILENCE_RELU = 10 * 60_000;
/** Une phrase n'est jamais gardée plus longtemps (ms), même lue sans arrêt. */
export const PHRASE_PLAFOND = 3 * 60 * 60_000;

/** Le moteur tel que le widget s'en sert : une demande, une parole (src/valhalla/parole.ts, ParoleOdin.parler). */
export interface MoteurParole { parler(d: Demande): Promise<Parole> }

/** Ce que le moteur rend, relu sans confiance : une phrase bornée et ses boutons (trois au plus). */
export interface ParoleLue { texte: string; propositions: PropositionLue[] }
export interface PropositionLue {
  label: string;
  act?: { module: string; action: string; read: boolean; grave: boolean; input?: Record<string, string | number | boolean> };
  demander?: string;
  ouvrir?: string;
}

const TEXTE_MAX = 1000, LABEL_MAX = 60, DEMANDER_MAX = 400, PROPS_MAX = 3;
const ID = /^[a-z0-9_-]{1,40}$/i, ID_ACTION = /^[a-z_][a-z0-9_]{0,39}$/i, OUVRIR = /^(app|vue):[a-z0-9_-]{1,40}$/i;
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

/** Les réglages d'une action, relus : dix au plus, des clés simples, des valeurs simples et courtes. */
function entreeLue(v: unknown): Record<string, string | number | boolean> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 10)) {
    if (!ID_ACTION.test(k)) continue;
    if (typeof x === 'string') out[k] = x.slice(0, 200); else if (typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x))) out[k] = x;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Une proposition du moteur, relue : un libellé et UNE façon de faire connue ; sinon rien. */
export function propositionLue(p: unknown): PropositionLue | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const o = p as Record<string, unknown>, label = str(o.label, LABEL_MAX).trim();
  if (!label) return undefined;
  const a = o.act && typeof o.act === 'object' ? o.act as Record<string, unknown> : undefined;
  if (a) {
    if (typeof a.module !== 'string' || !ID.test(a.module) || typeof a.action !== 'string' || !ID_ACTION.test(a.action)) return undefined;
    const input = entreeLue(a.input);
    // « read » faux par défaut : une action dont on ne sait pas qu'elle ne fait que lire demande l'accord.
    return { label, act: { module: a.module, action: a.action, read: a.read === true, grave: a.grave === true, ...(input ? { input } : {}) } };
  }
  const demander = str(o.demander, DEMANDER_MAX).trim();
  if (demander) return { label, demander };
  if (typeof o.ouvrir === 'string' && OUVRIR.test(o.ouvrir)) return { label, ouvrir: o.ouvrir };
  // Le mode d'emploi d'une page (« guide ») n'a pas de sens dans un widget : le moteur ne le propose pas tout seul.
  return undefined;
}

/** Une parole du moteur, relue. */
export function paroleLue(p: unknown): ParoleLue {
  const o = p && typeof p === 'object' ? p as Record<string, unknown> : {};
  const props = (Array.isArray(o.propositions) ? o.propositions : []).map(propositionLue).filter((x): x is PropositionLue => x !== undefined).slice(0, PROPS_MAX);
  return { texte: str(o.texte, TEXTE_MAX).trim(), propositions: props };
}

/** Ce que le widget garde, par moteur (un Odin d'essai a le sien) : la dernière parole, quand elle a été demandée, la dernière lecture et le dernier échec. */
interface Garde { parole?: ParoleLue; demandeA: number; luA: number; echecA?: number; enCours?: Promise<DuMoment | undefined> }
/** La parole du moment et l'heure de sa demande. */
export interface DuMoment { parole: ParoleLue; at: number }
const GARDES = new WeakMap<MoteurParole, Garde>();

/** La demande faite au moteur : comme la mascotte qui parle toute seule, sur l'accueil. */
export const DEMANDE_WIDGET: Demande = { quand: 'spontane', vue: 'home' };

/**
 * Ce qu'Odin dit maintenant pour le widget, selon la règle d'en tête : la phrase gardée, ou une seule demande au
 * moteur quand elle est due. Rend `undefined` si le moteur n'a pas répondu (rien de gardé n'est perdu).
 */
export async function paroleDuMoment(m: MoteurParole, maintenant: number): Promise<DuMoment | undefined> {
  const g = GARDES.get(m);
  if (g?.enCours) { g.luA = maintenant; return g.enCours; }
  const garde = (x: Garde) => (x.parole ? { parole: x.parole, at: x.demandeA } : undefined);
  if (g) {
    const age = maintenant - g.demandeA, absent = maintenant - g.luA >= ABSENCE;
    const due = g.parole?.texte ? (age >= PHRASE_GARDEE && absent) || age >= PHRASE_PLAFOND : !g.parole || age >= SILENCE_RELU;
    const echoue = g.echecA !== undefined && maintenant - g.echecA < SILENCE_RELU;
    g.luA = maintenant;
    if (!due || echoue) return garde(g);
  }
  const n: Garde = g ?? { demandeA: maintenant, luA: maintenant };
  n.luA = maintenant;
  n.enCours = (async () => {
    try { const p = paroleLue(await m.parler({ ...DEMANDE_WIDGET })); n.parole = p; n.demandeA = maintenant; n.echecA = undefined; return garde(n); }
    catch { n.echecA = maintenant; return garde(n); }
    finally { n.enCours = undefined; }
  })();
  GARDES.set(m, n);
  return n.enCours;
}

export const SORTES_PAROLE = [
  {
    // « Odin » : son visage (dessiné par la page, le même que la mascotte), sa phrase et ses boutons, « Autre chose ».
    // La maquette : 4 × 2 au départ, 3 × 2 au plus petit. Rien de neuf : « vide » (rien_de_neuf), la page montre son
    // visage au repos et « Autre chose », sans phrase. Moteur pas encore prêt : « source_absente ».
    id: 'parole', famille: 'odin', applis: [], taille: { mini: [3, 2], r: 2 }, styles: ['simple'], posable: true, jamaisALaMaison: true,
    nettoyer: (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; },
    lire: async (_w, src, l): Promise<EtatWidget> => {
      // La règle commune l'a déjà dit (propriétaire seul, jamais à la maison) ; redit ici, avant le moteur, par prudence.
      if (l.qui !== 'proprietaire' || l.ecran !== 'accueil') return { etat: 'refuse', raison: 'proprietaire_seul' };
      const m = src.moteurParole?.();
      if (!m) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const d = await paroleDuMoment(m, src.maintenant());
      if (!d) return { etat: 'source_absente', raison: 'lecture_echouee' };
      const p = d.parole;
      if (!p.texte) return { etat: 'vide', raison: 'rien_de_neuf' };
      // Datée de sa demande : une phrase gardée ne passe pas pour fraîche.
      return { etat: 'ok', at: d.at, donnee: { texte: p.texte, propositions: p.propositions } };
    },
  },
] as const satisfies readonly SorteWidget[];
