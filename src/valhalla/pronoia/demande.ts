// Prónoia — lot 2 : anticiper la demande et la suite de l'échange, par des ESTIMATIONS statistiques écrites dans Odin :
//   - les demandes semblables sont regroupées par leurs mots porteurs (`keywords` des habitudes) ;
//   - la probabilité d'un groupe « maintenant » : ses occurrences passées pondérées par la proximité de l'heure, le même
//     jour de la semaine et la fraîcheur (noyau simple, normalisé sur les groupes) ;
//   - l'enchaînement : après la demande précédente (même séance), un bigramme lissé vers la probabilité du moment ;
//   - la complétion pendant la frappe : les demandes connues qui commencent par ce qui est tapé, pondérées comme ci-dessus,
//     multipliées par la part HISTORIQUE des demandes déjà connues (une demande nouvelle reste toujours possible).
// Pur (aucune entrée/sortie) : testable avec un faux historique et une fausse horloge.
import { keywords, detectHabits, habitWhen } from '../../learn/habits.ts';
import type { Demande, Source } from './types.ts';

const MIN = 60_000, JOUR = 86_400_000;
/** Deux demandes à moins de 30 min font partie de la même séance (pour les enchaînements). */
export const SEANCE_MS = 30 * MIN;
/** Le modèle garde au plus ces demandes (comme le magasin), reconstruit au-delà de BORNE_HAUTE. */
export const BORNE = 2000, BORNE_HAUTE = 2200;
/** Lissage du bigramme vers la probabilité du moment (poids en « nombre d'exemples »). */
const LISSAGE = 2;
const plat = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
const jaccard = (a: string[], b: string[]) => { const B = new Set(b); const i = a.filter((x) => B.has(x)).length; return i / (new Set([...a, ...b]).size || 1); };

export interface Groupe {
  cle: string;
  mots: string[];
  /** texte → nombre de fois */
  textes: Map<string, number>;
  ats: number[];
  /** pour chaque occurrence : ouvrait-elle une séance (aucune demande dans les 30 min avant) ? */
  debuts: boolean[];
}

export interface Candidat {
  cle: string;
  /** le texte représentatif (le plus fréquent du groupe) ou la complétion */
  texte: string;
  confiance: number;
  sources: Source[];
}

export class ModeleDemandes {
  readonly groupes: Groupe[] = [];
  private trans = new Map<string, Map<string, number>>();
  private depuis = new Map<string, number>();
  private nouveaux = 0;
  private total = 0;
  private derniere?: { cle: string; at: number };
  /** les demandes vues (bornées), pour repérer les habitudes à la demande */
  private vues: Demande[] = [];
  /** habitudes repérées (detectHabits), recalculées seulement quand une demande a été apprise entre-temps */
  private habitudes?: { at: number; l: Array<{ mots: string[]; quand: string }> };

  constructor(demandes: Demande[], _maintenant: number) {
    for (const d of [...demandes].sort((a, b) => a.at - b.at)) this.apprendre(d);
  }

  private habitudesA(maintenant: number): Array<{ mots: string[]; quand: string }> {
    if (this.habitudes && Math.abs(this.habitudes.at - maintenant) < 3_600_000) return this.habitudes.l;
    let l: Array<{ mots: string[]; quand: string }> = [];
    try { l = detectHabits(this.vues.map((d) => ({ t: d.at, text: d.texte, tools: [] })), maintenant).map((h) => ({ mots: h.key.split(' '), quand: habitWhen(h) })); } catch { l = []; }
    this.habitudes = { at: maintenant, l };
    return l;
  }

  /** Le groupe d'un texte (sans le créer) ; undefined si aucun ne ressemble assez. */
  groupeDe(texte: string): Groupe | undefined {
    const kw = keywords(texte);
    if (!kw.length) return undefined;
    let meilleur: Groupe | undefined, m = 0.5 - 1e-9;
    for (const g of this.groupes) { const j = jaccard(g.mots, kw); if (j > m) { m = j; meilleur = g; } }
    return meilleur;
  }

  /**
   * Ajoute une demande au modèle (incrémental). Borné comme le magasin : au-delà de BORNE_HAUTE (2 200) demandes vues, le
   * modèle est reconstruit sur les BORNE (2 000) plus récentes (les occurrences, textes et enchaînements anciens tombent).
   */
  apprendre(d: Demande): void {
    if (!keywords(d.texte).length) return;
    this.vues.push(d);
    this.habitudes = undefined;
    if (this.vues.length > BORNE_HAUTE) { this.reconstruire(this.vues.slice(-BORNE)); return; }
    this.ajouter(d);
  }

  private reconstruire(l: Demande[]): void {
    this.groupes.length = 0; this.trans.clear(); this.depuis.clear();
    this.nouveaux = 0; this.total = 0; this.derniere = undefined;
    this.vues = l;
    for (const d of l) this.ajouter(d);
  }

  private ajouter(d: Demande): void {
    const kw = keywords(d.texte);
    if (!kw.length) return;
    let g = this.groupeDe(d.texte);
    this.total++;
    if (!g) { g = { cle: [...kw].sort().join(' '), mots: [...kw], textes: new Map(), ats: [], debuts: [] }; this.groupes.push(g); this.nouveaux++; }
    const t = d.texte.trim().slice(0, 240);
    g.textes.set(t, (g.textes.get(t) ?? 0) + 1);
    g.ats.push(d.at);
    g.debuts.push(!(this.derniere && d.at - this.derniere.at <= SEANCE_MS && d.at >= this.derniere.at));
    if (this.derniere && d.at - this.derniere.at <= SEANCE_MS && d.at >= this.derniere.at) {
      const m = this.trans.get(this.derniere.cle) ?? new Map<string, number>();
      m.set(g.cle, (m.get(g.cle) ?? 0) + 1); this.trans.set(this.derniere.cle, m);
      this.depuis.set(this.derniere.cle, (this.depuis.get(this.derniere.cle) ?? 0) + 1);
    }
    this.derniere = { cle: g.cle, at: d.at };
  }

  /** Part historique des demandes qui ressemblaient à une demande déjà connue (lissée). */
  partConnue(): number { return this.total ? (this.total - this.nouveaux + 1) / (this.total + 2) : 0; }

  private texteDe(g: Groupe): string { return [...g.textes.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0]; }

  /**
   * Poids « maintenant » de chaque groupe (heure proche, même jour, fraîcheur), normalisés à 1. On ne compte que les
   * occurrences du même cas : ouverture de séance (rien demandé depuis 30 min) ou milieu de séance — ce qu'on demande
   * en premier n'est pas ce qu'on demande ensuite.
   */
  probaMoment(maintenant: number, debutSeance: boolean): Map<string, number> {
    const n = new Date(maintenant), mn = n.getHours() * 60 + n.getMinutes(), dow = n.getDay();
    const poids = new Map<string, number>(); let somme = 0;
    for (const g of this.groupes) {
      let w = 0;
      for (let i = 0; i < g.ats.length; i++) {
        const at = g.ats[i];
        if (at > maintenant || g.debuts[i] !== debutSeance) continue;
        const d = new Date(at), m = d.getHours() * 60 + d.getMinutes();
        const dm = Math.min(Math.abs(m - mn), 1440 - Math.abs(m - mn));
        w += Math.exp(-(dm * dm) / (2 * 60 * 60)) * (d.getDay() === dow ? 1.5 : 1) * Math.exp(-(maintenant - at) / (30 * JOUR));
      }
      w += 1e-3 * g.ats.length; // un plancher minuscule : un groupe connu n'a jamais une probabilité nulle
      poids.set(g.cle, w); somme += w;
    }
    if (somme > 0) for (const [k, v] of poids) poids.set(k, v / somme);
    return poids;
  }

  /** La probabilité de chaque groupe comme PROCHAINE demande, sachant la précédente si elle est de la même séance. */
  distribution(maintenant: number, precedente?: { cle: string; at: number }): Map<string, number> {
    const prec = precedente ?? this.derniere;
    if (!prec || maintenant - prec.at > SEANCE_MS) return this.probaMoment(maintenant, true);
    const pm = this.probaMoment(maintenant, false);
    const m = this.trans.get(prec.cle), n = this.depuis.get(prec.cle) ?? 0;
    if (!m || !n) return pm;
    const out = new Map<string, number>();
    for (const [k, p] of pm) out.set(k, ((m.get(k) ?? 0) + LISSAGE * p) / (n + LISSAGE));
    return out;
  }

  private sources(g: Groupe, maintenant: number, viaEnchainement?: { de: string; n: number; tot: number }): Source[] {
    const s: Source[] = [];
    const h = this.habitudesA(maintenant).find((x) => jaccard(x.mots, g.mots) >= 0.5);
    if (h) s.push({ type: 'habitude', detail: `habitude repérée : ${h.quand}` });
    const jours = new Set(g.ats.filter((a) => a <= maintenant).map((a) => new Date(a).toDateString())).size;
    s.push({ type: 'heure', detail: `demandé ${g.ats.length} fois sur ${jours} jour(s), surtout à des heures proches de maintenant` });
    if (viaEnchainement) s.push({ type: 'enchainement', detail: `après « ${viaEnchainement.de} », ${viaEnchainement.n} fois sur ${viaEnchainement.tot}` });
    return s;
  }

  /** Les k prochaines demandes les plus probables. */
  prochaines(maintenant: number, k = 3, precedente?: { cle: string; at: number }): Candidat[] {
    const d = this.distribution(maintenant, precedente);
    const prec = precedente ?? this.derniere;
    const enSeance = prec && maintenant - prec.at <= SEANCE_MS ? prec : undefined;
    return [...d.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([cle, p]) => {
      const g = this.groupes.find((x) => x.cle === cle)!;
      const tr = enSeance ? { de: this.texteDe(this.groupes.find((x) => x.cle === enSeance.cle) ?? g), n: this.trans.get(enSeance.cle)?.get(cle) ?? 0, tot: this.depuis.get(enSeance.cle) ?? 0 } : undefined;
      return { cle, texte: this.texteDe(g), confiance: p, sources: this.sources(g, maintenant, tr && tr.tot ? tr : undefined) };
    });
  }

  /** Les questions qui suivront probablement CE texte (enchaînements observés, lissés). */
  questionsSuivantes(texte: string, maintenant: number, k = 3): Candidat[] {
    const g = this.groupeDe(texte);
    if (!g) return [];
    return this.prochaines(maintenant, k, { cle: g.cle, at: maintenant }).filter((c) => c.cle !== g.cle || (this.trans.get(g.cle)?.get(g.cle) ?? 0) > 0);
  }

  /** Complétion pendant la frappe : les demandes connues qui commencent par ce qui est tapé (ou le contiennent). */
  completer(prefixe: string, maintenant: number, k = 3): Candidat[] {
    const p = plat(prefixe);
    if (p.length < 2) return [];
    const pm = this.distribution(maintenant);
    const cands: Array<{ g: Groupe; texte: string; score: number }> = [];
    for (const g of this.groupes) {
      const tot = [...g.textes.values()].reduce((s, x) => s + x, 0);
      for (const [t, n] of g.textes) {
        const pt = plat(t);
        if (pt === p) continue;
        const debut = pt.startsWith(p), dedans = p.length >= 6 && pt.includes(p);
        if (!debut && !dedans) continue;
        cands.push({ g, texte: t, score: (pm.get(g.cle) ?? 0) * (n / tot) * (debut ? 1 : 0.5) });
      }
    }
    const somme = cands.reduce((s, c) => s + c.score, 0);
    if (!somme) return [];
    const connue = this.partConnue();
    return cands.sort((a, b) => b.score - a.score).slice(0, k).map((c) => ({
      cle: c.g.cle, texte: c.texte, confiance: (c.score / somme) * connue,
      sources: [{ type: 'heure', detail: `tu as déjà tapé cette demande ${c.g.textes.get(c.texte)} fois` }, ...this.sources(c.g, maintenant).filter((s) => s.type === 'habitude')],
    }));
  }
}
