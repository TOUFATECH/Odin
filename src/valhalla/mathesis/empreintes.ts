// Mathésis — les empreintes « déjà analysé » : Odin ne refait jamais deux fois le même travail. Une page (ou, aux
// passages suivants, une vidéo, une image, un son) dont l'empreinte du contenu est connue n'est pas réanalysée,
// même trouvée sous une autre adresse. Bornées (les plus anciennes tombent).
import type { Magasin } from './magasin.ts';

export interface Empreinte { at: number; quoi: string }
export const EMPREINTES_MAX = 20_000;

export class Empreintes {
  private readonly magasin: Magasin;
  private readonly maintenant: () => number;
  constructor(magasin: Magasin, maintenant: () => number) { this.magasin = magasin; this.maintenant = maintenant; }
  private tout(): Record<string, Empreinte> { return this.magasin.lire<Record<string, Empreinte>>('empreintes', {}); }
  dejaAnalyse(empreinte: string): boolean { return Object.prototype.hasOwnProperty.call(this.tout(), empreinte); }
  marquer(empreinte: string, quoi: string): void {
    const t = { ...this.tout() };
    t[empreinte] = { at: this.maintenant(), quoi: quoi.slice(0, 200) };
    const cles = Object.keys(t);
    if (cles.length > EMPREINTES_MAX) {
      for (const k of cles.sort((a, b) => t[a].at - t[b].at).slice(0, cles.length - EMPREINTES_MAX)) delete t[k];
    }
    this.magasin.ecrire('empreintes', t);
  }
  oublier(empreinte: string): void { const t = { ...this.tout() }; delete t[empreinte]; this.magasin.ecrire('empreintes', t); }
  taille(): number { return Object.keys(this.tout()).length; }
}
