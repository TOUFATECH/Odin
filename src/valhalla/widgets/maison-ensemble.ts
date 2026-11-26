// La famille « Maison » des widgets, la maison d'un coup d'œil (maquette validée « Accueil ») : ses scènes, le bandeau
// d'état et « Ma maison ». Rangées dans ce fichier pour ne pas écrire dans celui des petits chiffres (maison.ts) ; la
// famille, le public et la lecture commune sont les leurs (la même fonction `lecture` : jamais pour un membre).
// - Les scènes : celles que Midgard garde (aucune au départ : c'est lui qui les crée, dans Odin), chacune par son nom,
//   le nombre de ses étapes et si elle ouvre la maison (la règle de Midgard qui demande son accord, sceneRisk : lue par
//   la source). Jamais une phrase dans la donnée : l'interface la fait. Lancer : seulement le propriétaire, sur l'accueil,
//   par la route qui existe (POST /api/maison/scene), qui redemande son accord pour une scène qui ouvre. Ni scène
//   « active », ni icône : Odin ne les garde pas.
// - Le bandeau : seulement des faits vrais, comptés sur les appareils que l'écran de la maison reçoit déjà (les comptes
//   des petits chiffres, pas une copie) ; un fait qu'Odin ne sait pas (une alarme, la musique, un portail) n'a pas de puce.
// - « Ma maison » : les pièces, les appareils, ceux sans nouvelles, puis les comptes des petits chiffres.
import { ALLUMABLES, calculAllumes, calculSerrures, calculTemperature, etiquette, lecture, sansNouvelles as muet } from './maison.ts';
import type { AppareilVu, EtatWidget, SorteWidget } from './sorte.ts';

const base = { famille: 'maison', applis: ['midgard'], styles: ['simple'], public: 'maison', posable: true, nettoyer: etiquette } as const;
/** La donnée d'un calcul des petits chiffres, ou rien (« vide » : il n'y a pas ces appareils). */
const donneeDe = (e: EtatWidget) => (e.etat === 'ok' ? e.donnee : undefined);
const allumables = calculAllumes((a) => ALLUMABLES.includes(a.sorte)), lumieres = calculAllumes((a) => a.sorte === 'lumière'), clims = calculAllumes((a) => a.sorte === 'clim');
const entier = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : 0);
/** Sans nouvelles : hors ligne, muet depuis plus de 24 h, ou sans état lu (la règle des « muets » des petits chiffres, la même fonction). */
const sansNouvelles = (liste: readonly AppareilVu[], t: number) => liste.filter((a) => muet(a, t)).length;
/** Les scènes servies au plus (le nombre total est toujours dit). */
const SCENES_MAX = 48;

export const SORTES_MAISON_ENSEMBLE = [
  // Les scènes (maquette : 4 × 3, 3 × 2 au moins).
  {
    id: 'maison_scenes', ...base, taille: { mini: [3, 2], r: 3 },
    lire: async (_w, src, l): Promise<EtatWidget> => {
      if (l.qui === 'membre') return { etat: 'refuse', raison: 'proprietaire_seul' };
      if (!src.scenesMaison) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const liste = src.scenesMaison();
      if (!Array.isArray(liste)) return { etat: 'source_absente', raison: 'appli_muette' };
      if (!liste.length) return { etat: 'vide', raison: 'aucune_scene' };
      return { etat: 'ok', at: src.maintenant(), donnee: {
        scenes: liste.slice(0, SCENES_MAX).map((x) => ({ nom: String(x.nom).slice(0, 200), etapes: entier(x.etapes), ouvre: x.ouvre === true })),
        total: liste.length,
        // Lancer d'ici : lui seul, sur l'accueil (l'écran de la maison a ses propres boutons de scène).
        lancer: l.qui === 'proprietaire' && l.ecran === 'accueil',
      } };
    },
  },
  // Le bandeau d'état (maquette : 12 × 1, 6 × 1 au moins ; ici 4 × 1 au moins, la plus large mini que la grille admet :
  // ce qui ne tient pas est compté). Les puces, de la plus pressante à la plus calme.
  {
    id: 'maison_bandeau', ...base, taille: { mini: [4, 1], r: 1 },
    lire: lecture((liste, t) => {
      if (!liste.length) return { etat: 'vide', raison: 'aucun_appareil' };
      const puces: Array<Record<string, unknown>> = [];
      const ser = donneeDe(calculSerrures(liste, t)), tout = donneeDe(allumables(liste, t)), lum = donneeDe(lumieres(liste, t)), cl = donneeDe(clims(liste, t)), muets = sansNouvelles(liste, t);
      if (ser && entier(ser.ouvertes) > 0) puces.push({ fait: 'serrures_ouvertes', n: ser.ouvertes, sur: ser.sur });
      if (muets) puces.push({ fait: 'sans_nouvelles', n: muets, sur: liste.length });
      // « Tout est éteint » : seulement si chaque appareil qui s'allume est connu et éteint.
      const eteint = Boolean(tout) && tout!.n === 0 && !entier(tout!.muets) && !entier(tout!.inconnus);
      if (eteint) puces.push({ fait: 'tout_eteint', sur: tout!.sur });
      else {
        if (lum && entier(lum.n) > 0) puces.push({ fait: 'lumieres_allumees', n: lum.n, sur: lum.sur });
        if (cl && entier(cl.n) > 0) puces.push({ fait: 'clims_allumees', n: cl.n, sur: cl.sur });
      }
      // Toutes les serrures verrouillées : seulement si chacune est connue et verrouillée.
      if (ser && entier(ser.sur) > 0 && ser.n === ser.sur) puces.push({ fait: 'serrures_verrouillees', n: ser.n, sur: ser.sur });
      return puces.length ? { etat: 'ok', at: t, donnee: { puces } } : { etat: 'vide', raison: 'rien_a_dire' };
    }),
  },
  // « Ma maison » (maquette : 6 × 4, 4 × 3 au moins). Une ligne absente : Odin n'a pas ces appareils (jamais un 0).
  {
    id: 'ma_maison', ...base, taille: { mini: [4, 3], r: 4 },
    lire: lecture((liste, t, unites) => {
      if (!liste.length) return { etat: 'vide', raison: 'aucun_appareil' };
      const pieces = new Set(liste.map((a) => String(a.piece ?? '').trim()).filter(Boolean)).size;
      const temp = calculTemperature(liste, t, unites);
      const tout = donneeDe(allumables(liste, t)), lum = donneeDe(lumieres(liste, t)), ser = donneeDe(calculSerrures(liste, t));
      return { etat: 'ok', at: t, donnee: {
        pieces, appareils: liste.length, sansNouvelles: sansNouvelles(liste, t),
        ...(tout ? { allumes: tout } : {}), ...(lum ? { lumieres: lum } : {}), ...(ser ? { serrures: ser } : {}),
        ...(temp.etat === 'ok' ? { temperature: { ...temp.donnee, at: temp.at } } : {}),
      } };
    }),
  },
] as const satisfies readonly SorteWidget[];
