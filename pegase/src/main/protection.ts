// Protection de Pégase : bloqueur dans les pages, DNS chiffré, téléchargements en quarantaine.
import type { Session } from 'electron';
import type { ProfilOuvert } from './profil';
import type { Fenetre } from './fenetre';

export class Protection {
  telechargements = { liste: (_p: ProfilOuvert) => [] as any[] };
  constructor(readonly appli: unknown, readonly racine: string) {}
  async demarrer(): Promise<void> {}
  preparerSession(_s: Session, _p: ProfilOuvert): void {}
  etat(p: ProfilOuvert) { return { bloquesTotal: p.bloquesTotal, dns: 'système', dnsChiffre: false, filtres: 0, pret: false }; }
  async action(_f: Fenetre, _a: string, _arg: any): Promise<any> { return undefined; }
}
