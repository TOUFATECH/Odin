// La famille « medias » des widgets (maquette validée « Accueil », les cartes « Lecteur » et « Messages ») :
// - « Lecteur » : ses radios et ses listes d'Apollon (src/valhalla/modules/aegir.ts, aEcouter), chacune lancée d'un appui
//   par l'action qui existe (« jouer ») ; « Arrêter » par l'action qui existe (« stop »). Ce qui a été lancé : ce
//   qu'Apollon garde (enCours : quoi, l'enceinte, depuis quand), jamais « en cours » : Apollon ne sait pas si cela joue
//   encore. Ni position, ni durée, ni précédent, ni suivant, ni pause : Apollon ne les connaît pas. Jamais une adresse.
// - « Messages » : ses conversations récentes, celles que la page reçoit déjà (/api/state, « conversations ») : le titre,
//   d'où elle vient quand Odin le sait, sa dernière heure. Aucun compteur de « non lus » (il n'existe pas), aucun texte de
//   message. Seulement celles de la Discussion (un appui y mène) : jamais celles d'une autre sorte.
// - Au propriétaire seul, sur son accueil seul : un membre (même avec le droit sur Apollon), une tablette « maison »,
//   l'écran de la maison : refusés AVANT toute lecture (index.ts, droitDeVoir : public « propriétaire » et la marque
//   « jamais sur l'écran de la maison »), et la lecture le redit. La route des widgets ne s'ouvre ni à une clé d'accès ni
//   sans session. Un membre garde, comme avant, la page d'Apollon s'il en a le droit : rien n'est élargi ici.
// - Les conversations appartiennent au cœur d'Odin (sa mémoire), pas à Valhalla : lisibles ici seulement par un
//   branchement posé une fois par allModules (src/valhalla/odin.ts). Rien n'est gardé ni écrit dans un journal ici.
// - Rien n'est montré tant qu'Odin n'a pas la vraie donnée (sa réponse à la question 13) : Apollon coupée ou absente,
//   « source_absente » ; ni radio ni liste, « vide » ; aucune conversation, « vide ».
import type { EtatWidget, Lecteur, SorteWidget, SourceWidget } from './sorte.ts';

type LectureConversations = NonNullable<SourceWidget['conversationsRecentes']>;
let branche: LectureConversations | undefined;
/** Branche la lecture des conversations récentes d'Odin (src/valhalla/odin.ts, allModules). Rien : plus rien n'est lu. */
export const brancherConversations = (f: LectureConversations | undefined): void => { branche = f; };
/** La lecture branchée, ou rien. */
export const conversationsBranchees = (): LectureConversations | undefined => branche;

/** Le libellé choisi par la personne : 40 signes. */
const etiquette: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; };
/** Les radios, les listes et les conversations servies au plus ; le total dit le reste (« et N de plus »). */
export const RADIOS_SERVIES = 20, CONVERSATIONS_SERVIES = 12;
/** Un nom ou un titre : du texte, borné (la page le coupe à l'écran, l'entier en info-bulle). */
const NOM_MAX = 200;
const objet = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? x as Record<string, unknown> : {});
const texte = (x: unknown): string => (typeof x === 'string' ? x.slice(0, NOM_MAX) : '');
/** Une heure lue (ms) : un nombre fini, plus grand que zéro ; sinon rien. */
const instant = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined);
/** Lui seul, sur son accueil : redit au moment de lire, même si une règle d'au-dessus changeait. */
const seulLui = (l: Lecteur): EtatWidget | undefined => (l?.qui === 'proprietaire' && l.ecran === 'accueil' ? undefined : { etat: 'refuse', raison: 'proprietaire_seul' });

/**
 * D'où vient une conversation de la Discussion, quand Odin le sait (les mêmes que la Discussion étiquette, ui.html,
 * ORIGINE_FIL ; « principal » : la Discussion elle-même ; « raccourci » : le téléphone). Une conversation neuve
 * (« c-… ») : rien de plus. Toute autre : hors de la Discussion, pas servie.
 */
const ORIGINES = ['principal', 'raccourci', 'maison', 'voix', 'venus', 'cerveau', 'reglages'];
const dansLaDiscussion = (peer: string) => ORIGINES.includes(peer) || /^c-[a-z0-9]{1,38}$/.test(peer);
const SORTES_LANCEES = ['radio', 'liste', 'morceau'];

export const SORTES_MEDIAS = [
  {
    // « Lecteur » (la maquette : « media », 4 × 2, 3 × 2 au moins), l'appli Apollon.
    id: 'lecteur', famille: 'medias', applis: ['aegir'], taille: { mini: [3, 2], r: 2 }, styles: ['simple'], posable: true, jamaisALaMaison: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const non = seulLui(l); if (non) return non;
      if (!src.apollon) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const a = src.apollon();
      if (!a) return { etat: 'source_absente', raison: 'appli_absente' };
      const radios = (Array.isArray(a.radios) ? a.radios : []).map(texte).filter(Boolean);
      const listes = (Array.isArray(a.listes) ? a.listes : []).map(objet).filter((x) => texte(x.nom) && Number.isInteger(x.morceaux) && (x.morceaux as number) > 0).map((x) => ({ nom: texte(x.nom), morceaux: x.morceaux as number }));
      const j = objet(a.joue), depuis = instant(j.depuis), quoi = texte(j.quoi), enceinte = texte(j.enceinte);
      const joue = quoi && depuis && SORTES_LANCEES.includes(String(j.sorte)) ? { quoi, sorte: String(j.sorte), ...(enceinte ? { enceinte } : {}), depuis } : undefined;
      if (!radios.length && !listes.length && !joue) return { etat: 'vide', raison: 'rien_a_ecouter' };
      // Les boutons : seulement si l'action existe toujours chez Apollon (le serveur la redemande de toute façon).
      const jouer = Boolean(src.action('aegir', 'jouer', { quoi: radios[0] ?? listes[0]?.nom ?? '' })), arreter = Boolean(src.action('aegir', 'stop', {}));
      return { etat: 'ok', at: src.maintenant(), donnee: { radios: radios.slice(0, RADIOS_SERVIES), listes: listes.slice(0, RADIOS_SERVIES), ...(joue ? { joue } : {}), jouer, arreter } };
    },
  },
  {
    // « Messages » (la maquette : « bifrost », 4 × 2, 3 × 2 au moins). Aucune appli de Valhalla derrière.
    id: 'messages', famille: 'medias', applis: [], taille: { mini: [3, 2], r: 2 }, styles: ['liste'], posable: true, jamaisALaMaison: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const non = seulLui(l); if (non) return non;
      if (!src.conversationsRecentes) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const r = src.conversationsRecentes();
      if (!r) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const toutes = (Array.isArray(r) ? r : []).map(objet).filter((x) => typeof x.peer === 'string' && dansLaDiscussion(x.peer)).map((x, i) => {
        const at = instant(x.at), peer = x.peer as string, origine = ORIGINES.includes(peer) ? peer : '';
        return { i, c: { titre: texte(x.titre), ...(at ? { at } : {}), ...(origine ? { origine } : {}) } };
      });
      if (!toutes.length) return { etat: 'vide', raison: 'aucune_conversation' };
      // La plus récente d'abord ; sans heure lisible, à la fin.
      const rangees = toutes.sort((x, y) => (y.c.at ?? 0) - (x.c.at ?? 0) || x.i - y.i).map((x) => x.c);
      return { etat: 'ok', at: src.maintenant(), donnee: { total: rangees.length, conversations: rangees.slice(0, CONVERSATIONS_SERVIES) } };
    },
  },
] as const satisfies readonly SorteWidget[];
