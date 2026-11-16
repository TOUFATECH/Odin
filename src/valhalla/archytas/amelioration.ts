// L'amélioration continue, honnête. À chaque usage on a mesuré (temps, succès/échec). Odin PROPOSE une
// version améliorée (plus rapide, plus robuste, plus lisible). Mais une version améliorée ne REMPLACE
// l'ancienne QUE si elle garde le même comportement attendu et passe les mêmes vérifications (porte de
// qualité), sans régression : les versions sont gardées, le retour arrière est possible, et un script
// « code » qui agit sur le monde réel n'est remplacé qu'avec l'accord du propriétaire (Heimdall).
//
// « Même comportement » pour un script déclaratif = la même suite d'actions d'applis (mêmes module.action,
// dans le même ordre). Un changement de cette suite est un changement de comportement : refusé sans accord.
// Pour un script « code », on ne sait pas prouver l'équivalence : on exige l'accord du propriétaire.

import type { Etape, Proposeur, ScriptDetail, Stat } from './scripts.ts';
import { actionsDe } from './moteur-declaratif.ts';

export interface Candidat { pourquoi: string; apercuChange: string; etapes?: Etape[]; code?: string }
export interface PorteResultat { ok: boolean; raison: string }

/**
 * La porte de qualité. Un candidat remplace l'ancien seulement si :
 *  - déclaratif : il appelle exactement les mêmes actions d'applis, dans le même ordre (même comportement) ;
 *  - code : jamais sans l'accord du propriétaire (on ne sait pas prouver l'équivalence d'un code libre).
 * Rend { ok, raison } ; refus par défaut (on ne promet jamais une sécurité qu'on n'a pas).
 */
export function porteQualite(ancien: ScriptDetail, candidat: Candidat, accord?: boolean): PorteResultat {
  if (ancien.genre === 'code') {
    if (!accord) return { ok: false, raison: 'un script « code » agit potentiellement sur le monde réel : son remplacement demande ton accord (on ne sait pas prouver l\'équivalence d\'un code libre).' };
    return { ok: true, raison: 'remplacement d\'un script « code » autorisé par le propriétaire.' };
  }
  const avant = actionsDe(ancien.etapes), apres = actionsDe(candidat.etapes);
  if (avant.length !== apres.length || avant.some((a, i) => a !== apres[i])) {
    return { ok: false, raison: `comportement changé : la suite d'actions diffère (avant : ${avant.join(' → ') || 'aucune'} ; après : ${apres.join(' → ') || 'aucune'}). Refusé sans ton accord.` };
  }
  return { ok: true, raison: 'même comportement (même suite d\'actions) : amélioration sûre, appliquée.' };
}

/**
 * Le proposeur local, sans appel payant : il améliore la FORME en gardant le comportement. Il nettoie les
 * étapes déclaratives (retire une pose de variable répétée à l'identique juste après, étape vide), ce qui ne
 * touche jamais la suite des actions d'applis. S'il n'y a rien de sûr à proposer, il ne propose rien.
 * (Le raisonnement d'Odin, Mímir local et Noûs viendront enrichir ces propositions quand ils seront câblés.)
 */
export function proposeurLocal(): Proposeur {
  return {
    async proposer(detail: ScriptDetail, stat: Stat) {
      if (detail.genre !== 'declaratif' || !detail.etapes?.length) return undefined;
      const nettoyees = nettoyer(detail.etapes);
      if (JSON.stringify(nettoyees) === JSON.stringify(detail.etapes)) return undefined;
      const gagne = compter(detail.etapes) - compter(nettoyees);
      const pourquoi = `Code plus lisible : ${gagne} étape(s) inutile(s) retirée(s) (pose de variable répétée, étape vide), sans changer ce que le script fait.${stat.echecs ? ` ${stat.echecs} échec(s) mesuré(s).` : ''}`;
      return { pourquoi, apercuChange: `${compter(detail.etapes)} → ${compter(nettoyees)} étape(s)`, etapes: nettoyees };
    },
  };
}

/** Nombre d'étapes (récursif). Pur. */
function compter(etapes: Etape[]): number {
  let n = 0;
  const marche = (l: Etape[]): void => { for (const e of l) { n++; if (e.faire === 'si') { marche(e.alors); marche(e.sinon ?? []); } } };
  marche(etapes);
  return n;
}

/** Retire les poses de variable répétées à l'identique d'affilée (nettoyage de forme, comportement gardé). Pur. */
function nettoyer(etapes: Etape[]): Etape[] {
  const out: Etape[] = [];
  for (const e of etapes) {
    if (e.faire === 'poser') {
      const prec = out[out.length - 1];
      if (prec && prec.faire === 'poser' && prec.variable === e.variable && prec.valeur === e.valeur) continue;
    }
    out.push(e.faire === 'si' ? { ...e, alors: nettoyer(e.alors), ...(e.sinon ? { sinon: nettoyer(e.sinon) } : {}) } : e);
  }
  return out;
}
