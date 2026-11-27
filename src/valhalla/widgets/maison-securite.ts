// La famille « Maison » des widgets, sa sécurité (maquette validée « Accueil ») : « Sécurité » et « Caméra ». Rangées dans
// ce fichier pour ne pas écrire dans ceux des autres parts de la famille (maison.ts, maison-ensemble.ts,
// maison-appareils.ts) ; la famille est la même, AUCUN droit n'est élargi : ces deux sortes sont au propriétaire seul,
// sur son accueil seul, et portent la marque « jamais sur l'écran de la maison » (une tablette, une clé « complet » au
// mur : jamais). Ce qui les ferme est la règle commune (index.ts, droitDeVoir) : un public « propriétaire » refuse un
// membre et une tablette AVANT toute lecture, et admiseALaMaison refuse l'écran de la maison à tous, lui compris.
// - « Sécurité » : SES serrures et l'état lu de chacune (le compte de « maison_serrures », appliqué serrure par serrure :
//   la même règle, pas une copie) ; SES portes qui ouvrent la maison (un garage, un portail : la règle de Midgard qui
//   demande son accord, `sensitive`) avec l'état que l'appareil rend ; combien de caméras Cyclope connaît, et leurs noms.
//   Rien d'autre : ni alarme (rien n'existe dans Odin), ni « protégé », ni caméra « en ligne » (Odin ne le garde pas).
//   « Tout est fermé » : seulement si chaque serrure et chaque porte est lue et fermée. Un capteur de porte n'est pas
//   lu : Odin ne sait pas lequel de ses détecteurs est une porte. Rien ne se commande d'ici : la carte de l'appareil le fait.
// - « Caméra » : UNE caméra choisie (`cible` : « camera:<nom> ») ; la donnée ne porte que son nom, la page demande
//   l'image à la route qui existe (GET /api/maison/camera?nom=), qui la refuse à qui n'a pas tous les droits. À
//   l'enregistrement, son choix n'est gardé que si c'est une de ses caméras (gladsheim.ts, ciblesDeLaMaison) ; la liste
//   des choix (`choix`) n'est rendue qu'au propriétaire sur son accueil, pour « Régler ».
import type { Widget } from '../modules/gladsheim.ts';
import { calculSerrures, etiquette, sansNouvelles } from './maison.ts';
import type { AppareilVu, EtatWidget, Lecteur, SorteWidget, SourceWidget } from './sorte.ts';

/** Le propriétaire, sur son accueil : le seul à qui ces deux sortes rendent quelque chose (un second verrou, après droitDeVoir). */
const lui = (l: Lecteur) => l.qui === 'proprietaire' && l.ecran === 'accueil';
const entier = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : 0);
/** Les lignes servies au plus (le compte entier est toujours dit). */
const LIGNES_MAX = 48;
/** Les noms de caméras servis au plus. */
const CAMERAS_MAX = 48;
type EtatLu = 'fermee' | 'ouverte' | 'non_lu' | 'inconnu';
interface Ligne { nom: string; piece: string; etat: EtatLu }

/** L'état d'une serrure : la règle de « maison_serrures » (calculSerrures), appliquée à elle seule. */
function etatSerrure(a: AppareilVu, t: number): EtatLu {
  const e = calculSerrures([a], t);
  if (e.etat !== 'ok') return 'non_lu';
  const d = e.donnee;
  return entier(d.n) ? 'fermee' : entier(d.ouvertes) ? 'ouverte' : entier(d.muets) ? 'non_lu' : 'inconnu';
}
const FERMEE = new Set(['closed', 'ferme', 'fermé', 'fermee', 'fermée']);
const OUVERTE = new Set(['open', 'opening', 'closing', 'ouvert', 'ouverte']);
/** L'état d'une porte (un volet qui ouvre la maison) : ce que l'appareil rend ; sans nouvelles : non lu. */
function etatPorte(a: AppareilVu, t: number): EtatLu {
  if (sansNouvelles(a, t)) return 'non_lu';
  const e = String(a.etat ?? '').trim().toLowerCase();
  return FERMEE.has(e) ? 'fermee' : OUVERTE.has(e) ? 'ouverte' : 'inconnu';
}
const GRAVITE: Record<EtatLu, number> = { ouverte: 0, non_lu: 1, inconnu: 2, fermee: 3 };
/** Les lignes, la plus grave d'abord (un tri stable : à gravité égale, l'ordre des appareils). */
const parGravite = (l: Ligne[]) => l.map((x, i) => [x, i] as const).sort((a, b) => GRAVITE[a[0].etat] - GRAVITE[b[0].etat] || a[1] - b[1]).map((x) => x[0]);
const ligne = (a: AppareilVu, etat: EtatLu): Ligne => ({ nom: String(a.nom ?? '').slice(0, 200), piece: String(a.piece ?? '').slice(0, 200), etat });

const lireSecurite = async (_w: Widget, src: SourceWidget, l: Lecteur): Promise<EtatWidget> => {
  if (!lui(l)) return { etat: 'refuse', raison: 'proprietaire_seul' };
  if (!src.appareilsMaison) return { etat: 'source_absente', raison: 'pas_encore_lu' };
  const a = await src.appareilsMaison();
  if (!a || !Array.isArray(a.appareils)) return { etat: 'source_absente', raison: 'appli_muette' };
  const t = src.maintenant();
  // La règle de Midgard qui demande son accord (ouvrir la maison), lue à l'appel comme les autres parts de la famille.
  const { sensitive } = await import('../modules/midgard.ts');
  // Rangées par gravité (ouverte, non lue, inconnue, puis fermée ; l'ordre des appareils sinon) : ce qui est coupé, ici
  // ou par « et N de plus », n'est jamais une serrure ouverte cachée derrière des fermées.
  const serrures = parGravite(a.appareils.filter((x) => x.sorte === 'serrure').map((x) => ligne(x, etatSerrure(x, t))));
  const portes = parGravite(a.appareils.filter((x) => x.sorte === 'volet' && x.id && Boolean(sensitive(x.id, 'on'))).map((x) => ligne(x, etatPorte(x, t))));
  const cameras = src.camerasMaison?.();
  const noms = Array.isArray(cameras) ? cameras.map((x) => String(x)).filter((x) => x.trim()) : [];
  if (!serrures.length && !portes.length && !noms.length) return { etat: 'vide', raison: 'rien_a_surveiller' };
  const toutes = [...serrures, ...portes], compte = (k: EtatLu) => toutes.filter((x) => x.etat === k).length;
  return { etat: 'ok', at: t, donnee: {
    serrures: serrures.slice(0, LIGNES_MAX), ouvertures: portes.slice(0, LIGNES_MAX),
    comptes: { fermees: compte('fermee'), ouvertes: compte('ouverte'), nonLues: compte('non_lu'), inconnues: compte('inconnu') },
    toutFerme: toutes.length > 0 && toutes.every((x) => x.etat === 'fermee'),
    // Une ligne de caméras seulement s'il y en a (jamais un 0 à la place d'une absence).
    ...(noms.length ? { cameras: { n: noms.length, noms: noms.slice(0, CAMERAS_MAX).map((x) => x.slice(0, 80)) } } : {}),
  } };
};

/** Un nom de caméra comme la route le lit (80 signes au plus) ; les noms que porte tout objet ne sont jamais un choix. */
const NOM_MAX = 80;
const RESERVES = new Set(['__proto__', 'constructor', 'prototype']);
/** Le nom de la caméra choisie (« camera:<nom> »), ou rien. */
export function cameraDe(w: Pick<Widget, 'cible'>): string | undefined {
  const m = typeof w.cible === 'string' ? /^camera:(.+)$/s.exec(w.cible) : null;
  const nom = m ? m[1].trim() : '';
  return nom && nom.length <= NOM_MAX && !RESERVES.has(nom) ? nom : undefined;
}
const avecCamera: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => {
  if (o.label) out.label = t.str(o.label, 40);
  if (typeof o.cible === 'string' && o.cible.length <= NOM_MAX * 4) {
    const c = t.str(o.cible, NOM_MAX + 10), nom = cameraDe({ cible: c });
    if (nom && c.length <= NOM_MAX + 7) out.cible = `camera:${nom}`;
  }
  return true;
};
/** La liste des choix de « Régler » : les caméras de Cyclope, au propriétaire seul, sur son accueil seul. */
const choixDe = (noms: readonly string[]) => noms.filter((x) => cameraDe({ cible: `camera:${x}` }) === x).slice(0, 300).map((nom) => ({ cible: `camera:${nom}`, nom }));

const lireCamera = async (w: Widget, src: SourceWidget, l: Lecteur): Promise<EtatWidget> => {
  if (!lui(l)) return { etat: 'refuse', raison: 'proprietaire_seul' };
  if (!src.camerasMaison) return { etat: 'source_absente', raison: 'pas_encore_lu' };
  const liste = src.camerasMaison();
  if (!Array.isArray(liste)) return { etat: 'source_absente', raison: 'appli_absente' };
  const noms = liste.map((x) => String(x)), choix = choixDe(noms), avec = (e: EtatWidget): EtatWidget => Object.assign({}, e, { choix });
  const voulu = cameraDe(w);
  if (!voulu) return avec({ etat: 'vide', raison: noms.length ? 'camera_non_choisie' : 'aucune_camera' });
  // Retrouvée comme la route la retrouve (sans tenir compte des majuscules : himinbjorg.ts, preview).
  const nom = noms.find((x) => x.toLowerCase() === voulu.toLowerCase());
  if (!nom) return avec({ etat: 'vide', raison: 'camera_absente' });
  return { etat: 'ok', at: src.maintenant(), donnee: { nom } };
};

const base = { famille: 'maison', styles: ['simple'], posable: true, jamaisALaMaison: true } as const;

export const SORTES_MAISON_SECURITE = [
  // « Sécurité » (la maquette : 4 × 3, 3 × 3 au moins). Ses serrures, ses portes qui ouvrent la maison, ses caméras.
  { id: 'maison_securite', ...base, applis: ['midgard'], taille: { mini: [3, 3], r: 3 }, nettoyer: etiquette, lire: lireSecurite },
  // « Caméra » (la maquette : 4 × 3, 3 × 2 au moins). La vraie image d'une caméra de Cyclope.
  { id: 'maison_camera', ...base, applis: ['himinbjorg'], taille: { mini: [3, 2], r: 3 }, nettoyer: avecCamera, lire: lireCamera },
] as const satisfies readonly SorteWidget[];
