// Noûs — la tâche périodique branchée sur la passerelle (à côté des liens vivants), jamais sur le chemin de réponse :
//   - au besoin, le PREMIER CORPUS (une fois par version, selon `nous.corpusDepart`), rangé par petits lots qui
//     rendent la main à Odin entre chaque lot (jamais un long blocage) ;
//   - puis le vidage de la file unique vers le corpus chiffré et borné.
// Rien si Noûs est coupé, en mode privé ou en démonstration. Toutes les 5 minutes au plus. Ne lève jamais.
import type { FileApprentissage, NoosDeps } from './deps.ts';
import { enEssai, fileBornee } from './deps.ts';
import { depsNousOdin, viderVersCorpus, type BilanVidage, type OdinPourNous } from './file-odin.ts';
import { installerModeleDepart } from './livraison.ts';
import { departFait, fabriquerDepart, marquerDepart, type BilanDepart, type ChoixDepart, type SourcesDepart } from './corpus-depart.ts';

export const PERIODE_MS = 5 * 60_000;
/** Un lot du premier corpus : petit, pour ne jamais tenir Odin plus de quelques dizaines de millisecondes. */
export const LOT_DEPART = 150;
let dernier = 0;
let departEnCours = false;
/** Le dernier passage (pour la page : ce que ça a coûté). */
export const derniersBilans: { vidage?: BilanVidage & { quand: string }; depart?: BilanDepart & { quand: string; vidage?: BilanVidage }; installation?: { installe: boolean; raison: string; point?: number; quand: string } } = {};
/** Les dossiers d'Odin dont l'installation du modèle de départ a déjà été tentée (une fois par lancement). */
const departVerifie = new Set<string>();

const vide = (): BilanVidage => ({ pris: 0, ecrits: 0, ignores: 0, octets: 0, ms: 0 });
const ajouter = (t: BilanVidage, v: BilanVidage) => { t.pris += v.pris; t.ecrits += v.ecrits; t.ignores += v.ignores; t.octets += v.octets; t.ms = Math.round((t.ms + v.ms) * 10) / 10; if (v.raison) t.raison = v.raison; };

function preparer(odin: OdinPourNous, sources: SourcesDepart, deps?: NoosDeps): { b: BilanDepart; file: FileApprentissage } {
  const choix = (odin.cfg.nous?.corpusDepart ?? 'demander') as ChoixDepart;
  // Une file À PART, assez grande pour tout le premier corpus (bornée quand même).
  const file = fileBornee(60_000);
  const b = fabriquerDepart(odin.paths.home, { ...(deps ?? depsNousOdin(odin)), file }, choix, sources);
  return { b, file };
}

/**
 * Marque le premier corpus fait quand tout est rangé ; ou « fait, incomplet » quand le corpus est PLEIN (réglage
 * « disque ») : il n'est alors repris que si la place réglée grandit — plus jamais relu à chaque passage (constat 11).
 */
function marquerSiFini(odin: OdinPourNous, b: BilanDepart, vidage: BilanVidage, file: FileApprentissage): void {
  if (b.raison) return;
  if (!vidage.raison && !file.taille()) { marquerDepart(odin.paths.home, b); return; }
  if (/^corpus plein/.test(vidage.raison ?? '')) { file.vider(); marquerDepart(odin.paths.home, b, { incomplet: 'corpus plein (réglage « disque »)', disqueMaxMo: Number(odin.cfg.nous?.disqueMaxMo ?? 2000) }); }
}

/** Le premier corpus, maintenant, d'un seul tenant (essais, ligne de commande). */
export function faireDepart(odin: OdinPourNous, sources: SourcesDepart, o: { deps?: NoosDeps; dir?: string } = {}): BilanDepart & { vidage: BilanVidage } {
  const { b, file } = preparer(odin, sources, o.deps);
  const vidage = vide();
  while (file.taille()) {
    const v = viderVersCorpus(odin, { file, max: 2000, dir: o.dir });
    ajouter(vidage, v);
    if (v.raison || !v.pris) break;
  }
  marquerSiFini(odin, b, vidage, file);
  derniersBilans.depart = { ...b, quand: new Date().toISOString(), vidage };
  return { ...b, vidage };
}

/** Le premier corpus par petits lots, un lot par tour de la boucle d'Odin. Rend une promesse (essais). */
export function faireDepartParLots(odin: OdinPourNous, sources: SourcesDepart, o: { deps?: NoosDeps; dir?: string } = {}): Promise<BilanDepart & { vidage: BilanVidage; lots: number; pireLotMs: number }> {
  const { b, file } = preparer(odin, sources, o.deps);
  const vidage = vide();
  let lots = 0, pire = 0;
  departEnCours = true;
  return new Promise((fin) => {
    const lot = () => {
      try {
        // Noûs coupé, mode privé ou démonstration entre deux lots : viderVersCorpus vide la file sans rien garder.
        const v = viderVersCorpus(odin, { file, max: LOT_DEPART, dir: o.dir });
        ajouter(vidage, v); lots++; pire = Math.max(pire, v.ms);
        if (file.taille() && v.pris && !v.raison) { setImmediate(lot); return; }
      } catch { /* jamais bloquant */ }
      departEnCours = false;
      marquerSiFini(odin, b, vidage, file);
      const r = { ...b, vidage, lots, pireLotMs: pire };
      derniersBilans.depart = { ...b, quand: new Date().toISOString(), vidage };
      fin(r);
    };
    setImmediate(lot);
  });
}

/** Le passage périodique. `sources` est appelé seulement si le premier corpus reste à faire. */
export function tacheNous(odin: OdinPourNous, maintenant: number, sources: () => SourcesDepart, o: { dir?: string; forcer?: boolean } = {}): void {
  try {
    if (!o.forcer && maintenant - dernier < PERIODE_MS) return;
    dernier = maintenant;
    if (odin.cfg.nous?.actif === false || odin.demo || odin.cfg.voice?.privacy?.privateMode === true) { viderVersCorpus(odin, { dir: o.dir }); return; }
    // Le modèle de départ livré avec Odin, au premier passage : seulement s'il n'existe aucun point de reprise.
    if (!departVerifie.has(odin.paths.home) && !enEssai({})) { departVerifie.add(odin.paths.home); void installerModeleDepart(odin).then((r) => { derniersBilans.installation = { ...r, quand: new Date().toISOString() }; }); }
    const choix = (odin.cfg.nous?.corpusDepart ?? 'demander') as ChoixDepart;
    if ((choix === 'odin' || choix === 'memoire' || choix === 'livraison') && !departEnCours && !departFait(odin.paths.home, Number(odin.cfg.nous?.disqueMaxMo ?? 2000)).fait) void faireDepartParLots(odin, sources(), { dir: o.dir });
    const v = viderVersCorpus(odin, { dir: o.dir });
    if (v.pris || v.raison) derniersBilans.vidage = { ...v, quand: new Date(maintenant).toISOString() };
  } catch { /* jamais bloquant */ }
}
/** (essais) remet la période à zéro. */
export function oublierTacheNous(): void { dernier = 0; departEnCours = false; departVerifie.clear(); delete derniersBilans.installation; delete derniersBilans.vidage; delete derniersBilans.depart; }
