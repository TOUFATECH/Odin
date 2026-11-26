// La famille « Stockage » des widgets (maquette validée « Accueil », la carte de Pyramide) : le remplissage et la place
// libre de chaque volume de la machine d'Odin, ses partages et ses disques, tels que Pyramide les lit déjà (ses lectures
// « Disques » et « Partages », src/valhalla/modules/fensalir.ts) ; rien n'est lu ici d'une autre façon.
// - La machine d'Odin seulement (sa réponse à la question 17), jamais un autre poste, même si Pyramide sait en lire un.
// - Rien n'est montré tant qu'Odin n'a pas la vraie donnée (sa réponse à la question 13) : sur un système dont Pyramide
//   ne sait pas lire les disques (Windows aujourd'hui), « source_absente » avec son code, jamais « 0 % » ni un disque
//   inventé ; aucun volume lu : « source_absente » aussi. Aucun partage : un vrai résultat, la page le dit simplement.
// - Un volume presque plein passe devant : les volumes sont rangés du plus rempli au moins rempli.
// - Qui voit quoi : le widget suit le droit sur Pyramide. Le propriétaire ; un membre QUI A LE DROIT sur Pyramide ; un
//   membre sans ce droit : refusé avant toute lecture (index.ts, droitDeVoir), sans une valeur ni un nom. Une tablette
//   « maison » : refusée (ni la famille « infos » ni « maison »), et la lecture elle-même la refuse encore. La route des
//   widgets ne s'ouvre ni à une clé d'accès ni sans session. Aucune action depuis le widget : seulement « Ouvrir ».
// - Des noms (point de montage, disque, partage) : du texte, borné ; ni chemin de partage, ni compte, ni numéro de série.
// Ces lectures sont celles du moment (lsblk et df à chaque lecture de la page) : elles n'ont pas d'état « ancien ».
import type { EtatWidget, Lecteur, SorteWidget } from './sorte.ts';

/** Le libellé choisi par la personne : 40 signes. */
const etiquette: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; };
/** Les lignes servies au plus, par liste ; le total dit le reste (« et N de plus »). */
export const LIGNES_SERVIES = 20;
/** Un nom : du texte, borné (la page le coupe à l'écran, le nom entier en info-bulle). */
const NOM_MAX = 200;
const nom = (v: unknown) => (typeof v === 'string' ? v.slice(0, NOM_MAX) : '');
/** Un nombre d'octets lu : un nombre fini, positif ou nul ; sinon rien. */
const octets = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined);
const liste = (x: unknown): readonly unknown[] => (Array.isArray(x) ? x : []);
const objet = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? x as Record<string, unknown> : {});

/** Un volume monté lu sans confiance : un nom, une taille plus grande que zéro, l'utilisé et le libre ; sinon rien. */
function volumeLu(x: unknown): { nom: string; taille: number; utilise: number; libre: number } | undefined {
  const o = objet(x), taille = octets(o.taille), utilise = octets(o.utilise), libre = octets(o.libre), n = nom(o.monte);
  if (!n || !taille || utilise === undefined || libre === undefined) return undefined;
  // Jamais plus que plein, jamais plus libre que la taille (une lecture de travers ne fait pas un faux chiffre).
  return { nom: n, taille, utilise: Math.min(utilise, taille), libre: Math.min(libre, taille) };
}
/** Un disque lu sans confiance : son nom, sa taille, SSD ou non, amovible ou non ; ni modèle, ni numéro de série. */
function disqueLu(x: unknown): { nom: string; taille: number; ssd: boolean; amovible: boolean } | undefined {
  const o = objet(x), taille = octets(o.taille), n = nom(o.nom);
  return n && taille ? { nom: n, taille, ssd: o.ssd === true, amovible: o.amovible === true } : undefined;
}
/** Un partage lu sans confiance : son nom et sa sorte ; ni son dossier, ni ses comptes, ni ses clients. */
function partageLu(x: unknown): { nom: string; type: 'samba' | 'nfs' } | undefined {
  const o = objet(x), n = nom(o.nom);
  return n && (o.type === 'samba' || o.type === 'nfs') ? { nom: n, type: o.type } : undefined;
}
/** Une tablette « maison » : refusée, même si une règle d'au-dessus changeait (redit au moment de lire). */
const pasTablette = (l: Lecteur): EtatWidget | undefined => (l?.qui === 'proprietaire' || l?.qui === 'membre' ? undefined : { etat: 'refuse', raison: 'pas_pour_une_tablette' });

export const SORTES_STOCKAGE = [
  {
    // « Stockage » (la maquette : « NAS · stockage », 5 × 4, 3 × 2 au moins) : son style de départ, « Lignes ». Les
    // autres styles de la maquette (anneaux, cylindres, chargement, jauge) ne sont pas encore dessinés : non déclarés.
    id: 'stockage', famille: 'stockage', applis: ['fensalir'], taille: { mini: [3, 2], r: 4 }, styles: ['lignes'], public: 'membre', posable: true,
    nettoyer: etiquette,
    lire: async (_w, src, l): Promise<EtatWidget> => {
      const non = pasTablette(l); if (non) return non;
      if (!src.stockage) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const r = await src.stockage();
      if (!r) return { etat: 'source_absente', raison: 'appli_muette' };
      // Un système dont Pyramide ne lit pas les disques (Windows aujourd'hui) : Odin ne sait pas, il le dit.
      if (r.systeme !== 'linux' && r.systeme !== 'mac') return { etat: 'source_absente', raison: 'systeme_pas_encore_lu' };
      const volumes = liste(r.volumes).map(volumeLu).filter((x) => x !== undefined)
        .sort((a, b) => b.utilise / b.taille - a.utilise / a.taille || a.nom.localeCompare(b.nom));
      // Aucun volume lu (df a échoué) : rien d'affirmé, jamais un « 0 % ».
      if (!volumes.length) return { etat: 'source_absente', raison: 'lecture_echouee' };
      const disques = liste(r.disques).map(disqueLu).filter((x) => x !== undefined);
      const partages = liste(r.partages).map(partageLu).filter((x) => x !== undefined);
      const somme = (k: 'taille' | 'utilise' | 'libre') => volumes.reduce((s, v) => s + v[k], 0);
      return { etat: 'ok', at: src.maintenant(), donnee: {
        taille: somme('taille'), utilise: somme('utilise'), libre: somme('libre'),
        volumes: volumes.slice(0, LIGNES_SERVIES), volumesTotal: volumes.length,
        disques: disques.slice(0, LIGNES_SERVIES), disquesTotal: disques.length,
        partages: partages.slice(0, LIGNES_SERVIES), partagesTotal: partages.length,
      } };
    },
  },
] as const satisfies readonly SorteWidget[];
