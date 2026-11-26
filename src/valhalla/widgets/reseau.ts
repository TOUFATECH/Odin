// La famille « Réseau » des widgets (maquette validée « Accueil », la carte « Réseau » d'Horus) : les appareils du
// réseau tels que le registre d'Odin les connaît (src/hlidskjalf/inventory.ts, celui que la page Réseau montre), en ligne
// ou non au dernier balayage, et le débit seulement quand Ariane lit les paquets.
// - Le registre appartient au cœur d'Odin, pas à Valhalla : il n'est lisible ici que par un branchement, posé une fois
//   par allModules (src/valhalla/odin.ts), à côté des autres branchements du registre. Ce widget ne lance jamais de
//   balayage : il lit ce qui est déjà connu.
// - Au propriétaire seul, sur son accueil seul : ce widget montre les noms et les adresses des appareils de sa maison.
//   Un membre (même avec un droit sur Ariane), une tablette « maison », l'écran de la maison : refusés AVANT toute
//   lecture (index.ts, droitDeVoir : public « propriétaire » et la marque « jamais sur l'écran de la maison »), et la
//   lecture le redit. La route des widgets ne s'ouvre ni à une clé d'accès ni sans session.
// - Rien n'est montré tant qu'Odin n'a pas la vraie donnée (sa réponse à la question 13) : le registre pas branché,
//   « source_absente » ; aucun appareil connu, « vide » (la page mène à la page Réseau, qui les découvre) ; Ariane absente,
//   en pause ou qui ne lit pas : aucun débit servi (ni 0, ni tiret). Jamais de test de débit par appareil : il n'existe pas.
// - Un nom d'appareil vient de dehors (il est annoncé par l'appareil) : du texte, borné ; une adresse n'est servie que si
//   c'en est une.
import { isIP } from 'node:net';
import type { EtatWidget, Lecteur, SorteWidget, SourceWidget } from './sorte.ts';

type LectureAppareils = NonNullable<SourceWidget['appareilsReseau']>;
let branche: LectureAppareils | undefined;
/** Branche la lecture du registre réseau d'Odin (src/valhalla/odin.ts, allModules). Rien : plus rien n'est lu. */
export const brancherAppareilsReseau = (f: LectureAppareils | undefined): void => { branche = f; };
/** La lecture branchée, ou rien. */
export const appareilsReseauBranches = (): LectureAppareils | undefined => branche;

/** Le libellé choisi par la personne : 40 signes. */
const etiquette: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; };
/** Les appareils servis au plus ; le total dit le reste (« et N de plus »). */
export const LIGNES_SERVIES = 20;
/** Un nom : du texte, borné (la page le coupe à l'écran, le nom entier en info-bulle). */
const NOM_MAX = 200;
const objet = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? x as Record<string, unknown> : {});
/** Une heure lue (ms) : un nombre fini, plus grand que zéro ; sinon rien. */
const instant = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined);
/** Un débit lu (octets par seconde) : un nombre fini, positif ou nul ; sinon rien. */
const debitLu = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined);

export interface AppareilServi { nom: string; ip?: string; enLigne: boolean; vuA?: number }
/**
 * Un appareil lu sans confiance : un nom (sinon il n'est pas servi), son adresse si c'en est une, en ligne ou non, sa
 * dernière nouvelle. Rien de plus : la page n'affiche rien d'autre (la première fois vu, par exemple, n'est pas servie).
 */
function appareilLu(x: unknown): AppareilServi | undefined {
  const o = objet(x), nom = typeof o.nom === 'string' ? o.nom.trim().slice(0, NOM_MAX) : '';
  if (!nom) return undefined;
  const ip = typeof o.ip === 'string' && isIP(o.ip) ? o.ip : undefined, vuA = instant(o.vuA);
  return { nom, ...(ip ? { ip } : {}), enLigne: o.enLigne === true, ...(vuA ? { vuA } : {}) };
}
/**
 * Le débit servi est celui de TOUT le réseau : Ariane suit « tout le réseau » (`toutLeReseau`) et sa lecture tourne ; et
 * aucune machine n'est lue en plus au même moment (ses paquets seraient gardés deux fois, et comptés deux fois). Une
 * seule machine suivie : son débit n'est pas celui du réseau, rien n'est servi.
 */
export const reseauEntierLu = (suivis: readonly string[], toutLeReseau: string, enMarche: (portee: string) => boolean): boolean =>
  suivis.includes(toutLeReseau) && enMarche(toutLeReseau) && !suivis.some((sc) => sc !== toutLeReseau && enMarche(sc));
/** Lui seul, sur son accueil : redit au moment de lire, même si une règle d'au-dessus changeait. */
const seulLui = (l: Lecteur): EtatWidget | undefined => (l?.qui === 'proprietaire' && l.ecran === 'accueil' ? undefined : { etat: 'refuse', raison: 'proprietaire_seul' });

export const SORTES_RESEAU = [
  {
    // « Réseau » (la maquette : « hlidskjalf », 4 × 4, 3 × 2 au moins) : son style de départ, « Liste ». Les autres styles
    // de la maquette ne sont pas dessinés : « Carte du réseau » (à faire), « Débits et tests » (un test de débit par
    // appareil, qui n'existe pas). Aucune appli de Valhalla derrière (le registre est dans le cœur d'Odin).
    id: 'reseau', famille: 'reseau', applis: [], taille: { mini: [3, 2], r: 4 }, styles: ['liste'], posable: true, jamaisALaMaison: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const non = seulLui(l); if (non) return non;
      if (!src.appareilsReseau) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const r = src.appareilsReseau();
      // Le registre pas branché : Odin ne sait pas le lire ici (ce n'est pas une appli de Valhalla qui se tairait).
      if (!r) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const tous = (Array.isArray(r.appareils) ? r.appareils : []).map(appareilLu).filter((x) => x !== undefined);
      if (!tous.length) return { etat: 'vide', raison: 'aucun_appareil' };
      // En ligne d'abord (dans l'ordre du registre), puis hors ligne, le plus récemment vu d'abord.
      const rang = (a: AppareilServi) => (a.enLigne ? 0 : 1);
      const ranges = tous.map((a, i) => ({ a, i })).sort((x, y) => rang(x.a) - rang(y.a) || (x.a.enLigne ? 0 : (y.a.vuA ?? 0) - (x.a.vuA ?? 0)) || x.i - y.i).map((x) => x.a);
      // L'heure de la donnée (sorte.ts : « l'heure où elle a été lue ») : le dernier balayage ; sans balayage gardé, la
      // dernière nouvelle d'un appareil ; sans rien, l'heure de cette lecture. La page n'affiche que `balayeA`, absent
      // quand aucun balayage n'est gardé.
      const balayeA = instant(r.at), vus = tous.map((a) => a.vuA ?? 0), at = balayeA ?? (Math.max(...vus) || src.maintenant());
      // Le débit : seulement ce qu'Ariane mesure pendant qu'elle lit les paquets ; sinon rien n'est servi.
      const d = src.debitReseau?.(), recu = debitLu(d?.recu), envoye = debitLu(d?.envoye), debitA = instant(d?.at);
      return { etat: 'ok', at, donnee: {
        total: tous.length, enLigne: tous.filter((a) => a.enLigne).length,
        appareils: ranges.slice(0, LIGNES_SERVIES), ...(balayeA ? { balayeA } : {}),
        ...(recu !== undefined && envoye !== undefined && debitA ? { debit: { recu, envoye, at: debitA } } : {}),
      } };
    },
  },
] as const satisfies readonly SorteWidget[];
