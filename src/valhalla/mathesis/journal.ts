// Mathésis — le journal « ce qu'Odin a appris tout seul » : quoi, pourquoi, la source, la date, ce qu'il a retenu,
// ce qu'il a écarté ou supprimé. C'est ce que la page montrera (aujourd'hui, cette semaine) et ce que le propriétaire
// pourra corriger ou effacer. Borné : les plus anciennes entrées tombent.
import type { Magasin } from './magasin.ts';
import type { EntreeJournal } from './types.ts';
import { nouvelId } from './outils.ts';

export const JOURNAL_MAX = 3000;

export class Journal {
  private readonly magasin: Magasin;
  private readonly maintenant: () => number;
  constructor(magasin: Magasin, maintenant: () => number) { this.magasin = magasin; this.maintenant = maintenant; }
  noter(e: Omit<EntreeJournal, 'id' | 'at'>): EntreeJournal {
    const entree: EntreeJournal = { id: nouvelId(), at: this.maintenant(), ...e, quoi: e.quoi.slice(0, 400) };
    const l = [...this.magasin.lire<EntreeJournal[]>('journal', []), entree];
    this.magasin.ecrire('journal', l.slice(-JOURNAL_MAX));
    return entree;
  }
  /** Les entrées les plus récentes d'abord, depuis un instant (facultatif). */
  lire(o: { depuis?: number; n?: number } = {}): EntreeJournal[] {
    const l = this.magasin.lire<EntreeJournal[]>('journal', []).filter((e) => e.at >= (o.depuis ?? 0));
    return l.slice().reverse().slice(0, o.n ?? 200);
  }
  effacer(id: string): boolean {
    const l = this.magasin.lire<EntreeJournal[]>('journal', []);
    const r = l.filter((e) => e.id !== id);
    if (r.length === l.length) return false;
    this.magasin.ecrire('journal', r);
    return true;
  }
}
