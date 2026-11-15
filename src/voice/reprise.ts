// Reprise par segments : chaque réponse dite à voix haute est un plan et des segments (une phrase ou deux chacun).
// Quand on coupe Odin, on sait quel segment il disait et jusqu'où (temps joué) ; « continue » reprend au premier
// mot jamais dit, sans recommencer. Une question posée entre-temps s'empile : sa réponse est dite, puis
// « continue » revient à la réponse d'avant. Un sujet coupé depuis trop longtemps est oublié. Tout est pur.

export interface Segment { id: string; texte: string; /** dit en entier */ dit: boolean; /** ce qui reste à dire quand le segment a été coupé en cours */ reste?: string }
export interface Reponse { id: string; question: string; plan: string[]; segments: Segment[]; at: number; coupeeA?: number }

/** Découpe une réponse en segments à dire (phrases, puces), 240 caractères environ au plus chacun. */
export function decouper(texte: string, max = 240): string[] {
  const lignes = texte.replace(/\r/g, '').split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
  const out: string[] = [];
  for (const l of lignes) {
    const phrases = l.match(/[^.!?…]+(?:[.!?…]+["»”)]?|$)/g)?.map((x) => x.trim()).filter(Boolean) ?? [l];
    let cur = '';
    for (const p of phrases) {
      if (cur && (cur.length + p.length + 1 > max || cur.length >= 60)) { out.push(cur); cur = ''; }
      cur = cur ? `${cur} ${p}` : p;
      while (cur.length > max) { const i = cur.lastIndexOf(' ', max); const k = i > 40 ? i : max; out.push(cur.slice(0, k).trim()); cur = cur.slice(k).trim(); }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** « continue », « la suite », « reprends », « vas-y »… : reprendre là où Odin a été coupé. */
export function estContinue(texte: string): boolean {
  const t = texte.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z' -]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:(?:odin|ok|bon|oui|vas[ -]y|allez|d'accord)[ ,]+)*(?:continue|continues|continuer|reprends|reprend|la suite|et ensuite|et apres|tu disais|vas[ -]y continue|poursuis|termine|finis)(?: (?:stp|s'il te plait|ce que tu disais|ta phrase|ton explication))?$/.test(t);
}

/** Les mots déjà dits d'un segment coupé au bout de `joueMs` sur `dureeMs` (on recule d'un mot, par prudence). */
export function resteApres(texte: string, joueMs: number, dureeMs: number): string {
  const mots = texte.split(/\s+/).filter(Boolean);
  if (!(dureeMs > 0) || joueMs <= 0) return texte;
  const dits = Math.max(0, Math.floor((Math.min(joueMs, dureeMs) / dureeMs) * mots.length) - 1);
  return mots.slice(dits).join(' ');
}

export class Fil {
  private pile: Reponse[] = [];
  private n = 0;
  private readonly gardeMin: number;
  constructor(gardeMin = 30) { this.gardeMin = gardeMin; }

  /** Une nouvelle réponse : elle s'empile au-dessus de celle qui a été coupée (si elle a encore à dire). */
  nouvelle(question: string, texte: string, now = Date.now()): Reponse {
    this.oublier(now);
    // Une réponse entièrement dite n'a plus rien à reprendre : elle laisse sa place.
    this.pile = this.pile.filter((r) => r.segments.some((s) => !s.dit));
    const id = `r${++this.n}`, segs = decouper(texte);
    const r: Reponse = { id, question: question.slice(0, 300), plan: segs.map((s) => s.split(/\s+/).slice(0, 6).join(' ')), segments: segs.map((t, i) => ({ id: `${id}s${i + 1}`, texte: t, dit: false })), at: now };
    this.pile.push(r);
    if (this.pile.length > 5) this.pile.shift();
    return r;
  }
  private trouve(segment: string): { r: Reponse; i: number } | undefined {
    for (const r of this.pile) { const i = r.segments.findIndex((s) => s.id === segment); if (i >= 0) return { r, i }; }
    return undefined;
  }
  /** Ce segment a été dit jusqu'au bout. */
  dit(segment: string): void { const f = this.trouve(segment); if (f) { f.r.segments[f.i].dit = true; f.r.segments[f.i].reste = undefined; } }
  /** Odin a été coupé pendant ce segment, après `joueMs` de son (sur `dureeMs`) : ceux d'avant sont dits, celui-ci garde sa fin. */
  coupe(segment: string, joueMs = 0, dureeMs = 0, now = Date.now()): void {
    const f = this.trouve(segment); if (!f) return;
    for (let k = 0; k < f.i; k++) f.r.segments[k].dit = true;
    const s = f.r.segments[f.i], reste = resteApres(s.reste ?? s.texte, joueMs, dureeMs);
    s.reste = reste === s.texte ? undefined : reste;
    f.r.coupeeA = now;
  }
  /** « continue » : la réponse la plus récente qui a encore à dire, et ce qui reste (à partir du premier mot jamais dit). */
  continuer(now = Date.now()): { reponse: Reponse; segments: Array<{ id: string; texte: string }> } | undefined {
    this.oublier(now);
    while (this.pile.length) {
      const r = this.pile[this.pile.length - 1], restants = r.segments.filter((s) => !s.dit);
      if (restants.length) return { reponse: r, segments: restants.map((s) => ({ id: s.id, texte: s.reste ?? s.texte })) };
      this.pile.pop();
    }
    return undefined;
  }
  /** Les sujets coupés depuis plus de `gardeMin` minutes sont oubliés. */
  private oublier(now: number): void { this.pile = this.pile.filter((r) => now - (r.coupeeA ?? r.at) < this.gardeMin * 60_000); }
  get taille(): number { return this.pile.length; }
}
