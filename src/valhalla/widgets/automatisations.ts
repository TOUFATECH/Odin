// La famille « Automatisations » des widgets (maquette validée « Accueil ») : « Automatisations » (ses automatisations de
// Talos en clair, chacune avec son interrupteur) et « Tâches planifiées » (ce qui part encore aujourd'hui, à son heure).
// Tout vient de ce que Talos montre déjà dans sa liste « Automatismes » (src/web/talos-api.ts, lu tel quel par la
// source) : le nom, ce qu'elle fait, son rythme en clair, son état, sa prochaine heure. Rien n'est écrit ici.
// L'interrupteur (pages/widgets-automatisations.js) passe par la route de Talos qui existe (POST /api/draupnir/toggle),
// avec la confirmation que la page de Talos demande avant d'activer ; le widget ne crée ni ne change une automatisation.
// Qui voit quoi : au PROPRIÉTAIRE SEUL (une automatisation peut tout piloter). Un membre (même avec le droit sur Talos),
// une tablette « maison » : refusés avant toute lecture (le public de la sorte), et la lecture elle-même refuse encore
// qui n'est pas lui. La route des widgets ne s'ouvre ni à une clé d'accès ni sans session ; les routes de Talos non plus.
// Rien n'est montré tant qu'Odin n'a pas la vraie donnée (sa réponse à la question 13) : aucune automatisation, rien de
// prévu pour le reste du jour : l'état « vide » ; Talos désactivé : « source_absente » (appli_absente) ; Talos pas
// démarré ou qui ne répond pas : « source_absente » (appli_muette). Ces lectures sont celles du moment (Talos est dans
// Odin) : elles n'ont pas d'état « ancien ». « Ce qui part aujourd'hui » se compte dans le fuseau d'Odin, celui où Talos
// calcule ses heures, jamais celui de la machine ni de l'appareil.
import type { EtatWidget, Lecteur, SorteWidget } from './sorte.ts';

/** Le libellé choisi par la personne : 40 signes. */
const etiquette: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; };
/** Les lignes servies au plus ; le total dit le reste (« et N de plus »). */
export const LIGNES_SERVIES = 20;
/** Un nom, une phrase : du texte, borné (la page le coupe à l'écran, le nom entier en info-bulle). */
const TEXTE_MAX = 300;
/** Un identifiant d'automatisation tel que Talos les accepte sur ses routes (src/draupnir/dossiers.ts, RE_ID). */
const ID_FLOW = /^[\w-]{1,64}$/;
/** Ce qui part tout seul et a une heure : pas une veille (en continu), pas un rendez-vous de Chronos (son widget à lui). */
const SORTES_DU_JOUR: readonly string[] = ['automatisation', 'tache', 'tache_odin', 'rappel'];
const texte = (v: unknown) => String(v ?? '').slice(0, TEXTE_MAX);
/** Le propriétaire seul : la même règle que le public de la sorte, redite au moment de lire. */
const pasLui = (l: Lecteur): EtatWidget | undefined => (l?.qui === 'proprietaire' ? undefined : { etat: 'refuse', raison: 'proprietaire_seul' });
/** Le jour d'un instant dans un fuseau (« AAAA-M-J ») ; un fuseau que la machine ne connaît pas : rien. */
function jourDans(t: number, fuseau: string): string | undefined {
  try {
    const n: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat('en', { timeZone: fuseau, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(t))) n[p.type] = p.value;
    return `${n.year}-${n.month}-${n.day}`;
  } catch { return undefined; }
}

export const SORTES_AUTOMATISATIONS = [
  {
    // « Automatisations » (maquette : le nom, « quand → quoi », l'interrupteur ; « Nouvelle automatisation ») : ses
    // automatisations de Talos, dans l'ordre de Talos. `actif` est l'état vrai que Talos garde (en brouillon : faux) ;
    // l'identifiant n'est servi que s'il a la forme que la route de Talos accepte (sinon : pas d'interrupteur).
    id: 'automatisations', famille: 'automatisations', applis: ['draupnir'], taille: { mini: [4, 2], r: 3 }, styles: ['liste'], posable: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const non = pasLui(l); if (non) return non;
      if (!src.automatismes) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const r = await src.automatismes();
      if (!r) return { etat: 'source_absente', raison: 'appli_muette' };
      const flows = r.lignes.filter((x) => x && x.sorte === 'automatisation' && typeof x.id === 'string' && x.id.startsWith('flow:'));
      if (!flows.length) return { etat: 'vide', raison: 'aucune_automatisation' };
      const actif = (x: { etat: string }) => x.etat !== 'arret';
      const liste = flows.slice(0, LIGNES_SERVIES).map((x) => {
        const id = x.id.slice(5);
        return { ...(ID_FLOW.test(id) ? { id } : {}), nom: texte(x.nom), quand: texte(x.phrase), quoi: texte(x.quoi), actif: actif(x) };
      });
      return { etat: 'ok', at: src.maintenant(), donnee: { liste, total: flows.length, actives: flows.filter(actif).length } };
    },
  },
  {
    // « Tâches planifiées » (maquette : l'heure et le nom de ce qu'Odin fera tout seul aujourd'hui) : ce qui part encore
    // aujourd'hui, le plus proche d'abord, chacun à sa prochaine heure calculée par Talos. Ni ce qui est en pause, ni ce
    // qui est déjà passé, ni ce qui tombe demain dans le fuseau d'Odin. La page écrit l'heure dans ce fuseau.
    id: 'taches_planifiees', famille: 'automatisations', applis: ['draupnir'], taille: { mini: [3, 2], r: 3 }, styles: ['liste'], posable: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const non = pasLui(l); if (non) return non;
      if (!src.automatismes) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const r = await src.automatismes();
      if (!r) return { etat: 'source_absente', raison: 'appli_muette' };
      const maintenant = src.maintenant(), fuseau = String(r.fuseau ?? ''), jour = fuseau ? jourDans(maintenant, fuseau) : undefined;
      if (!jour) return { etat: 'source_absente', raison: 'lecture_echouee' };
      const prevues = r.lignes
        .filter((x) => x && SORTES_DU_JOUR.includes(x.sorte) && x.etat !== 'pause' && x.etat !== 'arret' && typeof x.prochaine === 'string')
        .map((x) => ({ x, at: Date.parse(String(x.prochaine)) }))
        .filter((y) => Number.isFinite(y.at) && y.at >= maintenant && jourDans(y.at, fuseau) === jour)
        .sort((a, b) => a.at - b.at);
      if (!prevues.length) return { etat: 'vide', raison: 'rien_aujourdhui' };
      const liste = prevues.slice(0, LIGNES_SERVIES).map((y) => ({ at: y.at, nom: texte(y.x.nom), sorte: y.x.sorte }));
      return { etat: 'ok', at: maintenant, donnee: { liste, total: prevues.length, fuseau, heure12: src.lieu().heure12 === true } };
    },
  },
] as const satisfies readonly SorteWidget[];
