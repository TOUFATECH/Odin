// Mathésis — « où trouver » : pour chaque fait appris d'une page, l'adresse PRÉCISE de la page, son titre et la date de
// lecture (demande du propriétaire, 17/11/2026 : « il me conseille directement l'endroit où une information arrive »).
// Quand le propriétaire cherche quelque chose, Odin répond « c'est expliqué ici : <titre> (<adresse>), lu le <date> ».
// Rien n'est noté en mode « ne pas garder » (l'appelant ne l'appelle pas).
import type { Magasin } from './magasin.ts';
import { dateCourte, motsUtiles } from './outils.ts';

export const OU_TROUVER_MAX = 5000;

export interface Endroit { texte: string; url: string; titre: string; site: string; at: number }

export class OuTrouver {
  private readonly magasin: Magasin;
  constructor(magasin: Magasin) { this.magasin = magasin; }
  tous(): Endroit[] { return this.magasin.lire<Endroit[]>('ouTrouver', []); }
  /** Note l'endroit d'un fait (sans doublon : même texte et même page). */
  noter(e: Endroit): void { this.noterTout([e]); }
  /** Note plusieurs endroits en UNE écriture (tous les faits d'une page). */
  noterTout(es: Endroit[]): void {
    if (!es.length) return;
    const cle = (x: { url: string; texte: string }) => `${x.url}\u0000${x.texte}`;
    const neufs = es.map((e) => ({ texte: e.texte.slice(0, 400), url: e.url.slice(0, 2000), titre: e.titre.slice(0, 200), site: e.site.slice(0, 200), at: e.at }));
    const remplaces = new Set(neufs.map(cle));
    const l = this.tous().filter((x) => !remplaces.has(cle(x)));
    l.push(...neufs);
    this.magasin.ecrire('ouTrouver', l.slice(-OU_TROUVER_MAX));
  }
  /** Retire tout ce qui vient d'un site (le propriétaire a demandé d'oublier ce site). Rend le nombre retiré. */
  oublierSite(site: string): number {
    const l = this.tous(), r = l.filter((x) => x.site.replace(/^www\./, '') !== site.replace(/^www\./, ''));
    if (r.length !== l.length) this.magasin.ecrire('ouTrouver', r);
    return l.length - r.length;
  }
  /**
   * Les endroits qui parlent de la question : les plus de mots en commun (texte du fait et titre de la page), puis les
   * plus récents. Une page n'apparaît qu'une fois. Pur sur ce qui est rangé.
   */
  chercher(question: string, n = 3): Array<Endroit & { score: number }> {
    const mots = motsUtiles(question);
    if (!mots.length) return [];
    const parPage = new Map<string, Endroit & { score: number }>();
    for (const e of this.tous()) {
      const ici = new Set(motsUtiles(`${e.titre} ${e.texte}`));
      const score = mots.filter((m) => ici.has(m)).length;
      if (score < Math.min(2, mots.length)) continue;
      const avant = parPage.get(e.url);
      if (!avant || score > avant.score || (score === avant.score && e.at > avant.at)) parPage.set(e.url, { ...e, score });
    }
    return [...parPage.values()].sort((a, b) => b.score - a.score || b.at - a.at).slice(0, n);
  }
  /** La réponse en clair. */
  static repondre(trouves: Endroit[]): string {
    if (!trouves.length) return 'Je n\'ai rien lu là-dessus pour l\'instant.';
    return trouves.map((e, i) => `${i ? 'Aussi' : 'C\'est expliqué ici'} : « ${e.titre || e.site} » (${e.url}), lu le ${dateCourte(e.at)} — ${e.texte.slice(0, 160)}`).join('\n');
  }
}
