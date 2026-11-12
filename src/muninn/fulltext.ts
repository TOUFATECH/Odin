// Recherche plein texte en mémoire vive (remplace FTS5 de SQLite) : mots sans accents ni
// majuscules, recherche par début de mot (« redém » trouve « redémarrer »), classement BM25.

const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const WORD = /[\p{L}\p{N}]+/gu;

/** Les mots d'une phrase libre utilisés pour chercher (2 lettres au moins, 16 au plus). */
export function queryWords(text: string): string[] {
  return [...new Set((fold(text).match(/[\p{L}\p{N}]{2,}/gu) ?? []))].slice(0, 16);
}

export class TextIndex {
  private readonly post = new Map<string, Map<number, number>>();
  private readonly docs = new Map<number, { len: number; terms: string[] }>();
  private totalLen = 0;

  get size(): number { return this.docs.size; }

  add(id: number, text: string): void {
    this.remove(id);
    const words = fold(text).match(WORD) ?? [];
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const [w, c] of tf) { let p = this.post.get(w); if (!p) { p = new Map(); this.post.set(w, p); } p.set(id, c); }
    this.docs.set(id, { len: words.length, terms: [...tf.keys()] });
    this.totalLen += words.length;
  }

  remove(id: number): void {
    const d = this.docs.get(id); if (!d) return;
    for (const w of d.terms) { const p = this.post.get(w); p?.delete(id); if (p && !p.size) this.post.delete(w); }
    this.totalLen -= d.len; this.docs.delete(id);
  }

  /** Documents qui contiennent au moins un mot cherché (au début d'un mot), du plus pertinent au moins pertinent. */
  search(query: string, keep: (id: number) => boolean = () => true, limit = 40): Array<{ id: number; score: number }> {
    const words = queryWords(query); if (!words.length || !this.docs.size) return [];
    const N = this.docs.size, avg = this.totalLen / N || 1, k1 = 1.2, b = 0.75;
    const scores = new Map<number, number>();
    for (const q of words) {
      for (const [term, p] of this.post) {
        if (!term.startsWith(q)) continue;
        const idf = Math.log(1 + (N - p.size + 0.5) / (p.size + 0.5));
        for (const [id, tf] of p) {
          const len = this.docs.get(id)!.len;
          scores.set(id, (scores.get(id) ?? 0) + idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * len / avg)));
        }
      }
    }
    return [...scores].filter(([id]) => keep(id)).map(([id, score]) => ({ id, score })).sort((x, y) => y.score - x.score).slice(0, limit);
  }
}

/** Extrait autour des mots trouvés, mots trouvés entre « », 16 mots au plus (comme snippet() de FTS5). */
export function snippet(text: string, query: string, width = 16): string {
  const words = queryWords(query), toks = [...text.matchAll(/\S+/g)];
  if (!toks.length) return '';
  const hit = (t: string) => { const f = fold(t).replace(/[^\p{L}\p{N}]/gu, ''); return words.some((w) => f.startsWith(w)); };
  const first = Math.max(0, toks.findIndex((m) => hit(m[0])));
  const start = Math.max(0, Math.min(first - Math.floor(width / 3), toks.length - width)), end = Math.min(toks.length, start + width);
  const body = toks.slice(start, end).map((m) => (hit(m[0]) ? `«${m[0]}»` : m[0])).join(' ');
  return `${start > 0 ? '…' : ''}${body}${end < toks.length ? '…' : ''}`;
}
