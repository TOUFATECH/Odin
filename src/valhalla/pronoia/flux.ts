// Prónoia — lot 4 : prévoir la suite probable d'une scène ou d'un son, À L'INTÉRIEUR d'une seule vidéo ou d'un seul son,
// à partir de sa ligne de temps reçue comme des données (étiquettes datées de l'œil — Théia — ou de l'oreille — Syrinx).
// But : MIEUX COMPRENDRE (une étiquette attendue est plus crédible, une étiquette très surprenante mérite un second
// regard), JAMAIS inventer : rien de prévu n'est ajouté à la ligne de temps. L'écart entre prévu et arrivé est transmis à
// Noûs comme erreur de prédiction.
// Technique, dite honnêtement : enchaînements entre étiquettes (bigrammes lissés), durée moyenne d'une étiquette, et
// retour régulier d'une même étiquette (période mesurée). Rien n'est gardé après le flux (aucun lien entre deux sources).
import type { Nourrir, PrevoyeurFlux } from './types.ts';

export interface OptionsFlux {
  source: 'theia' | 'syrinx';
  nourrir?: Nourrir;
  /** mode privé : rien n'est transmis à Noûs (la prévision reste en mémoire le temps du flux) */
  prive?: () => boolean;
  /** au-dessous de cette confiance, une observation est trop douteuse pour servir d'exemple */
  confianceMin?: number;
}

interface Attendue { etiquette: string; confiance: number; t: number; tol: number; via: string }
const BORNES = { observations: 2000, etiquettes: 200, attendues: 20 } as const;
const LISSAGE = 1;

export class FluxPrevoyeur implements PrevoyeurFlux {
  readonly source: 'theia' | 'syrinx';
  private o: OptionsFlux;
  private obs: Array<{ t: number; etiquette: string }> = [];
  private trans = new Map<string, Map<string, number>>();
  private depuis = new Map<string, number>();
  private durees = new Map<string, { somme: number; n: number }>();
  private vues = new Map<string, number[]>();
  private attendues: Attendue[] = [];
  /** ce qui a été jugé (pour le bilan du flux) */
  readonly jugees = { realisees: 0, ratees: 0 };

  constructor(o: OptionsFlux) { this.o = o; this.source = o.source; }

  private dernier(): { t: number; etiquette: string } | undefined { return this.obs[this.obs.length - 1]; }
  private envoyer(texte: string): void {
    try { if (this.o.prive?.() === true) return; } catch { return; }
    try { this.o.nourrir?.({ sorte: 'note', texte, source: `pronoia:flux:${this.source}`, fiable: true }); } catch { /* Noûs ne gêne jamais */ }
  }

  /** Une observation de la ligne de temps (secondes depuis le début du flux). Juge les attentes, puis apprend. */
  observer(obs: { t: number; etiquette: string; confiance: number }): void {
    if (!obs || !Number.isFinite(obs.t) || !obs.etiquette) return;
    if ((obs.confiance ?? 0) < (this.o.confianceMin ?? 0.3)) return; // trop douteux : ni juge ni exemple
    const e = String(obs.etiquette).slice(0, 80);
    this.juger(obs.t, e);
    const d = this.dernier();
    if (d && d.etiquette === e) return; // la même étiquette qui continue : rien de nouveau
    if (d) {
      if (!this.trans.has(d.etiquette) && this.trans.size >= BORNES.etiquettes) return;
      const m = this.trans.get(d.etiquette) ?? new Map<string, number>();
      m.set(e, (m.get(e) ?? 0) + 1); this.trans.set(d.etiquette, m);
      this.depuis.set(d.etiquette, (this.depuis.get(d.etiquette) ?? 0) + 1);
      const du = this.durees.get(d.etiquette) ?? { somme: 0, n: 0 }; du.somme += obs.t - d.t; du.n++; this.durees.set(d.etiquette, du);
    }
    const v = this.vues.get(e) ?? []; v.push(obs.t); if (v.length > 50) v.shift(); this.vues.set(e, v);
    this.obs.push({ t: obs.t, etiquette: e });
    if (this.obs.length > BORNES.observations) this.obs.shift();
  }

  /** Les attentes dont la fenêtre contient t et qui nomment e sont réalisées ; celles dont la fenêtre est passée, ratées. */
  private juger(t: number, e: string): void {
    const reste: Attendue[] = [];
    for (const a of this.attendues) {
      if (a.etiquette === e && Math.abs(t - a.t) <= a.tol) {
        this.jugees.realisees++;
        this.envoyer(`Flux ${this.source} — prévu : « ${a.etiquette} » vers ${a.t.toFixed(1)} s (confiance ${Math.floor(a.confiance * 100)} %, ${a.via}) ; arrivé à ${t.toFixed(1)} s (écart ${(t - a.t >= 0 ? '+' : '')}${(t - a.t).toFixed(1)} s).`);
      } else if (t > a.t + a.tol) {
        this.jugees.ratees++;
        this.envoyer(`Flux ${this.source} — prévu : « ${a.etiquette} » vers ${a.t.toFixed(1)} s (confiance ${Math.floor(a.confiance * 100)} %, ${a.via}) ; pas arrivé (vu « ${e} » à ${t.toFixed(1)} s).`);
      } else reste.push(a);
    }
    this.attendues = reste;
  }

  /** La probabilité de chaque étiquette comme SUIVANTE après `de` (bigramme lissé vers la fréquence générale). */
  private suivantes(de: string): Map<string, number> {
    const freq = new Map<string, number>(); let tot = 0;
    for (const o of this.obs) { if (o.etiquette === de) continue; freq.set(o.etiquette, (freq.get(o.etiquette) ?? 0) + 1); tot++; }
    const m = this.trans.get(de), n = this.depuis.get(de) ?? 0;
    const out = new Map<string, number>();
    // + 1 au dénominateur : une étiquette jamais vue reste possible (jamais 100 %).
    for (const [k, f] of freq) out.set(k, ((m?.get(k) ?? 0) + LISSAGE * (f / tot)) / (n + LISSAGE + 1));
    return out;
  }

  /** À quel point une étiquette était attendue maintenant (0..1) : faible = surprenante, à regarder de plus près. */
  attendu(etiquette: string): number | undefined {
    const d = this.dernier(); if (!d || !this.depuis.get(d.etiquette)) return undefined;
    return this.suivantes(d.etiquette).get(etiquette) ?? 0;
  }

  /**
   * La suite probable dans les `horizonS` secondes : l'étiquette suivante (enchaînement + durée moyenne) et les retours
   * réguliers. Chaque attente est retenue pour être jugée quand la suite réelle arrive.
   */
  suiteProbable(horizonS: number): Array<{ etiquette: string; confiance: number; t: number }> {
    const d = this.dernier(); if (!d) return [];
    const out: Attendue[] = [];
    const du = this.durees.get(d.etiquette);
    if (du && du.n && this.depuis.get(d.etiquette)) {
      const t = d.t + du.somme / du.n;
      if (t - d.t <= horizonS) {
        const [meilleure] = [...this.suivantes(d.etiquette).entries()].sort((a, b) => b[1] - a[1]);
        if (meilleure) out.push({ etiquette: meilleure[0], confiance: meilleure[1], t, tol: Math.max(1, 0.5 * (du.somme / du.n)), via: `après « ${d.etiquette} », ${this.trans.get(d.etiquette)?.get(meilleure[0]) ?? 0} fois sur ${this.depuis.get(d.etiquette)}` });
      }
    }
    for (const [e, v] of this.vues) {
      if (v.length < 4 || out.some((x) => x.etiquette === e)) continue;
      const iv = v.slice(1).map((x, k) => x - v[k]);
      const moy = iv.reduce((s, x) => s + x, 0) / iv.length;
      if (moy <= 0) continue;
      const t = v[v.length - 1] + moy;
      if (t <= d.t || t - d.t > horizonS) continue;
      const reguliers = iv.filter((x) => Math.abs(x - moy) <= 0.25 * moy).length;
      out.push({ etiquette: e, confiance: (reguliers) / (iv.length + 1), t, tol: Math.max(1, 0.25 * moy), via: `revient toutes les ${moy.toFixed(1)} s environ (${reguliers} intervalles réguliers sur ${iv.length})` });
    }
    for (const a of out) if (!this.attendues.some((x) => x.etiquette === a.etiquette && Math.abs(x.t - a.t) <= x.tol)) this.attendues.push(a);
    if (this.attendues.length > BORNES.attendues) this.attendues.splice(0, this.attendues.length - BORNES.attendues);
    // dans l'ordre du temps : la suite telle qu'elle viendrait
    return out.sort((a, b) => a.t - b.t || b.confiance - a.confiance).map(({ etiquette, confiance, t }) => ({ etiquette, confiance, t }));
  }

  /** Fin du flux : les attentes restantes ne sont pas jugées (périmées) ; tout est oublié. */
  fermer(): void { this.attendues = []; this.obs = []; this.trans.clear(); this.depuis.clear(); this.durees.clear(); this.vues.clear(); }
}
