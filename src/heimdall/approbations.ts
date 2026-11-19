// Le chemin des RÉPONSES aux validations : une demande de Heimdall attend ici la réponse du propriétaire. Sorti de la
// passerelle pour être dans le noyau (src/heimdall/noyau.ts) : si Odin pouvait réécrire « répondre oui tout seul »,
// toute validation tomberait. Seul le propriétaire répond ; une demande inconnue ou expirée ne vaut rien.
// Chaque demande garde le numéro de l'action exacte qu'elle montre (src/heimdall/actions-journal.ts) : une réponse qui dit
// le numéro qu'elle a vu ne vaut que si c'est celui-là (une action changée est une autre demande).
import type { ApprovalAnswer } from './policy.ts';
import { empreinteEnCours, numeroCourt } from './actions-journal.ts';

export type MotReponse = 'yes' | 'no' | 'always';

/** « oui », « non », « toujours »… (et leurs variantes) → la réponse. */
export function motReponse(mot: string): MotReponse {
  return /^(always|toujours)$/i.test(mot) ? 'always' : /^(no|non|nan)$/i.test(mot) ? 'no' : 'yes';
}

/** Ce qu'on répond à une réponse arrivée après l'échéance : Heimdall a déjà dit non, rien n'est parti. */
export const TROP_TARD = 'Trop tard : le délai de cette demande est passé, rien n\'est parti. Redemande-moi l\'action si tu la veux toujours.';

export class Approbations {
  private attente = new Map<string, { resolve: (answer: ApprovalAnswer) => void; echeance: number; resume: string; empreinte?: string }>();

  /** Nombre de demandes en attente (celles dont l'échéance vient de passer comprises, jusqu'à ce qu'elles soient oubliées). */
  get taille(): number { return this.attente.size; }
  /** La demande en attente quand il n'y en a qu'UNE (pour un « oui » tout court) ; plusieurs : aucune, il faut dire laquelle. */
  seule(): string | undefined { return this.attente.size === 1 ? [...this.attente.keys()][0] : undefined; }
  /** Ancien nom, gardé pour les appels existants : comme seule() (jamais « la dernière » quand plusieurs attendent). */
  derniere(): string | undefined { return this.seule(); }
  /** Les demandes encore dans les temps, de la plus ancienne à la plus récente (pour dire laquelle, avec son identifiant). */
  dansLesTemps(maintenant = Date.now()): Array<{ id: string; resume: string; numero?: string }> {
    return [...this.attente].filter(([, x]) => maintenant < x.echeance).map(([id, x]) => ({ id, resume: x.resume, ...(x.empreinte ? { numero: numeroCourt(x.empreinte) } : {}) }));
  }
  /**
   * Une demande attend sa réponse jusqu'à `echeanceMs` (au-delà, Heimdall a dit non : une réponse ne vaut plus rien) ;
   * oubliée d'elle-même après `oublierApresMs` (par défaut une minute après l'échéance, pour répondre « trop tard »).
   * Un nombre seul (forme d'avant) : l'échéance et l'oubli tombent ensemble. Le numéro de l'action : celui donné, sinon
   * celui de l'action dont Heimdall décide en ce moment.
   */
  attendre(id: string, d: number | { echeanceMs: number; oublierApresMs?: number; resume?: string; empreinte?: string }): Promise<ApprovalAnswer> {
    const o: { echeanceMs: number; oublierApresMs?: number; resume?: string; empreinte?: string } = typeof d === 'number' ? { echeanceMs: d, oublierApresMs: d } : d;
    const echeance = Date.now() + o.echeanceMs;
    const empreinte = o.empreinte ?? empreinteEnCours();
    const p = new Promise<ApprovalAnswer>((r) => this.attente.set(id, { resolve: r, echeance, resume: o.resume ?? '', ...(empreinte ? { empreinte } : {}) }));
    setTimeout(() => this.attente.delete(id), o.oublierApresMs ?? o.echeanceMs + 60_000).unref?.();
    return p;
  }
  /**
   * Répond à une demande. Refusé si ce n'est pas le propriétaire, si la demande est inconnue, si son échéance est passée,
   * ou si la réponse dit le numéro d'une AUTRE action que celle de la demande (`vu` : le numéro court ou entier vu).
   */
  repondre(id: string, mot: string, proprietaire: boolean, maintenant = Date.now(), vu?: string): { ok: true; reponse: MotReponse; numero?: string } | { ok: false; raison: string } {
    if (!proprietaire) return { ok: false, raison: 'Seul le propriétaire peut valider une action.' };
    const x = this.attente.get(id);
    if (!x) return { ok: false, raison: 'Demande inconnue ou expirée.' };
    if (maintenant >= x.echeance) return { ok: false, raison: TROP_TARD };
    if (vu !== undefined) {
      const v = vu.trim().toLowerCase();
      if (!x.empreinte || (v !== x.empreinte && v !== numeroCourt(x.empreinte))) return { ok: false, raison: `Cette réponse était pour l'action n° ${v.slice(0, 12) || '?'} ; la demande attend l'action n° ${x.empreinte ? numeroCourt(x.empreinte) : '?'} : rien n'est parti. Réponds à la demande telle qu'elle est montrée.` };
    }
    this.attente.delete(id);
    const reponse = motReponse(mot);
    x.resolve(reponse === 'always' ? 'always' : reponse === 'yes');
    return { ok: true, reponse, ...(x.empreinte ? { numero: numeroCourt(x.empreinte) } : {}) };
  }
}
