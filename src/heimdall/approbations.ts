// Le chemin des RÉPONSES aux validations : une demande de Heimdall attend ici la réponse du propriétaire. Sorti de la
// passerelle pour être dans le noyau (src/heimdall/noyau.ts) : si Odin pouvait réécrire « répondre oui tout seul »,
// toute validation tomberait. Seul le propriétaire répond ; une demande inconnue ou expirée ne vaut rien.
import type { ApprovalAnswer } from './policy.ts';

export type MotReponse = 'yes' | 'no' | 'always';

/** « oui », « non », « toujours »… (et leurs variantes) → la réponse. */
export function motReponse(mot: string): MotReponse {
  return /^(always|toujours)$/i.test(mot) ? 'always' : /^(no|non|nan)$/i.test(mot) ? 'no' : 'yes';
}

export class Approbations {
  private attente = new Map<string, (answer: ApprovalAnswer) => void>();

  /** Nombre de demandes en attente. */
  get taille(): number { return this.attente.size; }
  /** La dernière demande en attente (pour un « oui » tout court). */
  derniere(): string | undefined { return [...this.attente.keys()].at(-1); }
  /** Une demande attend sa réponse ; oubliée d'elle-même après `oublierApresMs`. */
  attendre(id: string, oublierApresMs: number): Promise<ApprovalAnswer> {
    const p = new Promise<ApprovalAnswer>((r) => this.attente.set(id, r));
    setTimeout(() => this.attente.delete(id), oublierApresMs).unref?.();
    return p;
  }
  /** Répond à une demande. Refusé si ce n'est pas le propriétaire, ou si la demande est inconnue ou expirée. */
  repondre(id: string, mot: string, proprietaire: boolean): { ok: true; reponse: MotReponse } | { ok: false; raison: string } {
    if (!proprietaire) return { ok: false, raison: 'Seul le propriétaire peut valider une action.' };
    const resolve = this.attente.get(id);
    if (!resolve) return { ok: false, raison: 'Demande inconnue ou expirée.' };
    this.attente.delete(id);
    const reponse = motReponse(mot);
    resolve(reponse === 'always' ? 'always' : reponse === 'yes');
    return { ok: true, reponse };
  }
}
