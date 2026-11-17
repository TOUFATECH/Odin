// Prónoia — le branchement sur Odin : le mode privé, Noûs (écart prévu/arrivé), les demandes du propriétaire et les
// événements des applis. Tout est protégé : une panne ici ne touche jamais Odin, rien ne bloque, et quand Prónoia est
// coupée (ou absente) ces fonctions ne font RIEN — le comportement d'Odin ne change pas.
//
// La préparation d'avance n'est PAS branchée ici : Odin n'a pas encore de lecture « préchauffable » (cache de
// recherche ou de rappel) que le chemin normal réutiliserait ; une réponse préparée ne remplace jamais la sienne.
import { type FileApprentissage, type NoosDeps } from '../../brain/nous/deps.ts';
import { fileNousOdin } from '../../brain/nous/file-odin.ts';
import { nourrir } from '../../brain/nous/entree.ts';
import { moteurPronoia, type OptionsPronoia } from './index.ts';
import type { EvenementDate } from './types.ts';

/** Ce dont le branchement a besoin d'Odin. */
export interface OdinPourPronoia {
  cfg: { voice?: { privacy?: { privateMode?: boolean } }; learning?: { observe?: boolean }; nous?: { actif?: boolean }; demo?: boolean };
}

/** La file d'apprentissage de Noûs : LA file unique d'Odin (src/brain/nous/file-odin.ts), vidée vers le corpus. */
export const fileNousPronoia: FileApprentissage = fileNousOdin;

export function optionsOdin(odin: OdinPourPronoia): OptionsPronoia {
  const prive = (): boolean => { try { return odin.cfg.voice?.privacy?.privateMode === true; } catch { return true; } };
  const nous: NoosDeps = {
    cfg: { learning: { observe: odin.cfg.learning?.observe !== false }, nous: { actif: odin.cfg.nous?.actif !== false } },
    privateMode: prive, demo: odin.cfg.demo === true, file: fileNousPronoia,
  };
  return { prive, nourrir: (n) => nourrir(nous, n) };
}

/** Le disque est dit « plein » à 95 % (la tendance estime quand il y arrivera). */
export const SEUIL_DISQUE = 95;
const dernierDisque = new Map<string, number>();

/** La file des événements à remettre, par dossier d'Odin : bornée, vidée par petits lots en rendant la main entre deux. */
export const FILE_MAX = 500, LOT = 50;
const files = new Map<string, { attente: EvenementDate[]; programmee: boolean }>();

/** (essais) oublie le rythme des mesures relayées et les files. */
export function oublierRelais(): void { dernierDisque.clear(); files.clear(); }

/**
 * Une demande du propriétaire vient d'être traitée : Prónoia juge ses prévisions et apprend APRÈS COUP (jamais dans le
 * fil de la réponse d'Odin), avec une sauvegarde différée. Rien si elle est coupée, absente ou en mode privé.
 */
export function noterDemandeOdin(home: string, texte: string, prive: boolean): void {
  if (!moteurPronoia(home)) return;
  setImmediate(() => { try { moteurPronoia(home)?.noterDemande(texte, { prive, differer: true }); } catch { /* jamais bloquant */ } });
}

function vider(home: string): void {
  const f = files.get(home); if (!f) return;
  f.programmee = false;
  const m = moteurPronoia(home);
  if (!m || !m.actif) { f.attente.length = 0; return; }
  for (const ev of f.attente.splice(0, LOT)) { try { m.recevoirEvenement(ev, { differer: true }); } catch { /* jamais bloquant */ } }
  // Le reste au prochain tour : setTimeout rend VRAIMENT la main (la page, la passerelle, les autres applis passent).
  if (f.attente.length) { f.programmee = true; setTimeout(() => vider(home), 0).unref?.(); }
}

/**
 * Un événement d'une appli (`ctx.emit` de Valhalla). Prónoia n'en apprend que si le couple (appli, type) est dans sa
 * liste blanche (la maison et les machines ; voir SOURCES_DEFAUT) ou ouvert par le propriétaire : tout le reste est
 * ignoré AVANT d'entrer. Converti en événement daté, mis dans une file bornée (ce qui déborde est laissé et compté),
 * remis par lots après coup. Le moteur refuse encore ce qui concerne une personne, le futur et le mode privé.
 */
export function relayerEvenement(home: string, e: { module: string; type: string; data?: Record<string, unknown>; at: string }): void {
  try {
    if (!e || typeof e !== 'object' || e.module === 'pronoia') return;
    const m = moteurPronoia(home);
    if (!m || !m.actif || !m.sourcePermise(e.module, e.type)) return;
    const d = e.data ?? {};
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
    const at = Date.parse(e.at);
    if (!Number.isFinite(at)) return;
    let ev: EvenementDate;
    // Eir mesure la machine : l'occupation du disque (en %) devient une mesure à seuil (« la machine va manquer de
    // place »), gardée au plus une fois par heure (Eir mesure bien plus souvent ; la tendance n'en a pas besoin).
    if (e.module === 'eir' && e.type === 'mesure') {
      const disque = num(d.disque);
      if (disque === undefined) return;
      const cle = `${home}|eir`;
      if ((dernierDisque.get(cle) ?? -Infinity) > at - 3_600_000) return;
      dernierDisque.set(cle, at);
      ev = { appli: 'eir', type: 'disque_occupe', at, valeur: disque, seuil: SEUIL_DISQUE };
    } else {
      ev = {
        appli: e.module, type: e.type, at,
        ...(typeof d.cle === 'string' ? { cle: d.cle } : {}),
        ...(num(d.valeur) !== undefined ? { valeur: num(d.valeur) } : {}),
        ...(num(d.seuil) !== undefined ? { seuil: num(d.seuil) } : {}),
        ...(d.sujet === 'proprietaire' || d.sujet === 'maison' ? { sujet: d.sujet } : d.sujet !== undefined ? { sujet: 'tiers' as const } : {}),
      };
    }
    let f = files.get(home);
    if (!f) { f = { attente: [], programmee: false }; files.set(home, f); }
    if (f.attente.length >= FILE_MAX) { m.evenementsLaisses++; return; }
    f.attente.push(ev);
    if (!f.programmee) { f.programmee = true; setTimeout(() => vider(home), 0).unref?.(); }
  } catch { /* jamais bloquant */ }
}
