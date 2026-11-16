// Index inversé des notes du Cerveau (lot B « répondre vite »).
//
// Avant : vault.search() balayait TOUTES les notes à chaque demande (title/body/props/tags), ce qui coûtait
// 85-97 ms à 3000-8000 notes. Ici, un index « mot → notes » donne tout de suite la petite liste des notes
// qui peuvent correspondre (les candidates) ; le classement exact (le même qu'avant) ne s'applique plus qu'à
// elles. Le résultat est IDENTIQUE au balayage : l'index ne sert qu'à écarter les notes qui n'ont aucun mot
// cherché (celles-là auraient de toute façon un score nul).
//
// Pourquoi « mêmes résultats » : une recherche garde une note dès qu'un mot cherché est présent (en sous-chaîne)
// dans le titre, le corps, les propriétés ou les étiquettes. Un mot cherché ne contient que des lettres/chiffres ;
// s'il apparaît dans le texte, il tient entièrement dans UN mot du texte (une suite de lettres/chiffres). Il suffit
// donc d'indexer les mots du texte et de retenir toute note dont un mot CONTIENT un mot cherché. On indexe le texte
// « plié » (sans accents ni majuscules) ET les étiquettes : c'est un sur-ensemble des notes que le balayage garde,
// et le classement exact écarte ensuite les notes au score nul — donc aucun écart.

import type { EventEmitter } from 'node:events';
import type { Note, Vault } from './vault.ts';

const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MOT = /[\p{L}\p{N}]{2,}/gu;

/** Les mots (lettres/chiffres, 2 au moins) d'une note : titre, corps, propriétés, étiquettes. Pur. */
export function motsDeNote(n: Note): Set<string> {
  const texte = `${n.title}\n${n.body}\n${JSON.stringify(n.meta)}\n${n.tags.join(' ')}`;
  return new Set(fold(texte).match(MOT) ?? []);
}

/** Les mots cherchés d'une demande, comme vault.search les découpe (2 lettres au moins). Pur. */
export function motsCherches(query: string): string[] {
  return fold(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
}

export class IndexNotes {
  /** mot du texte → chemins des notes qui le contiennent. */
  private readonly parMot = new Map<string, Set<string>>();
  /** chemin → note (pour rendre les notes candidates). */
  private readonly parChemin = new Map<string, Note>();

  get taille(): number { return this.parChemin.size; }

  /** (Re)construit l'index à partir d'une liste de notes. */
  construire(notes: Note[]): void {
    this.parMot.clear(); this.parChemin.clear();
    for (const n of notes) this.indexer(n);
  }

  /** Ajoute ou met à jour une note dans l'index. */
  indexer(n: Note): void {
    this.retirer(n.path);
    this.parChemin.set(n.path, n);
    for (const mot of motsDeNote(n)) {
      let s = this.parMot.get(mot); if (!s) { s = new Set(); this.parMot.set(mot, s); }
      s.add(n.path);
    }
  }

  /** Retire une note (note effacée ou renommée). */
  retirer(path: string): void {
    const n = this.parChemin.get(path); if (!n) return;
    for (const mot of motsDeNote(n)) { const s = this.parMot.get(mot); if (s) { s.delete(path); if (!s.size) this.parMot.delete(mot); } }
    this.parChemin.delete(path);
  }

  /**
   * Les notes candidates pour une demande : toute note dont un mot CONTIENT un mot cherché. Sur-ensemble des
   * notes au score non nul : le classement exact fait le tri ensuite, pour un résultat identique au balayage.
   */
  candidats(query: string): Note[] {
    const mots = motsCherches(query);
    if (!mots.length || !this.parChemin.size) return [];
    const chemins = new Set<string>();
    for (const [mot, s] of this.parMot) {
      for (const w of mots) {
        if (mot.includes(w)) { for (const p of s) chemins.add(p); break; }
      }
    }
    const out: Note[] = [];
    for (const p of chemins) { const n = this.parChemin.get(p); if (n) out.push(n); }
    return out;
  }

  /**
   * Suit un coffre : l'index se met à jour tout seul à chaque écriture, renommage ou mise à la corbeille,
   * sans tout reconstruire. On passe l'émetteur d'événements (vaultEvents) pour éviter toute dépendance
   * croisée. Rend une fonction pour se détacher. (En production, vault.search reconstruit aussi par identité
   * de la liste des notes : voir vault.ts.)
   */
  suivre(vault: Vault, events: EventEmitter): () => void {
    const surChange = (e: { kind?: string; path?: string }) => {
      if (!e?.path) return;
      if (e.kind === 'corbeille') this.retirer(e.path);
      else { const n = vault.find(e.path); if (n) this.indexer(n); }
    };
    const surRenomme = (e: { ancien?: string; nouveau?: string }) => {
      if (e?.ancien) this.retirer(e.ancien);
      if (e?.nouveau) { const n = vault.find(e.nouveau); if (n) this.indexer(n); }
    };
    events.on('change', surChange);
    events.on('renommée', surRenomme);
    return () => { events.off('change', surChange); events.off('renommée', surRenomme); };
  }
}
