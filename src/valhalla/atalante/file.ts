// Atalante · la file d'attente : priorité, 3 fichiers à la fois au plus (réglable), pause, reprise, arrêt, et plage
// d'heures creuses. Gardée dans file.json (0o600) ; les liens y sont chiffrés avec la clé de la machine
// (chiffrerChamp), car un lien signé vaut un jeton. En mémoire, ils sont en clair.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';

export type Etat = 'attente' | 'en_cours' | 'pause' | 'termine' | 'echec' | 'bloque' | 'arrete';
export interface Element {
  id: string; lien: string; nom: string; empreinte?: string;
  /** n'attend que la plage d'heures creuses */ creuses: boolean;
  /** ton accord pour une adresse de ton réseau */ maison?: boolean;
  priorite: number; etat: Etat; ajoute: string;
  fait?: number; total?: number; texte?: string; rangement?: string; sha256?: string; fini?: string;
}
export const OUVERTS: Etat[] = ['attente', 'en_cours', 'pause'];

export class FileAttente {
  private f: string; private home: string;
  elements: Element[] = [];
  constructor(dir: string, home: string) {
    this.f = join(dir, 'file.json'); this.home = home;
    try {
      const l = JSON.parse(readFileSync(this.f, 'utf8')) as Element[];
      // Au démarrage, ce qui était en cours reprend sa place dans la file (ses morceaux restent sur le disque).
      this.elements = l.map((e) => ({ ...e, lien: dechiffrerChamp(home, e.lien), etat: e.etat === 'en_cours' ? 'attente' : e.etat }));
    } catch { this.elements = []; }
  }
  sauver(): void {
    mkdirSync(join(this.f, '..'), { recursive: true, mode: 0o700 });
    const garder = [...this.elements.filter((e) => OUVERTS.includes(e.etat)), ...this.elements.filter((e) => !OUVERTS.includes(e.etat)).slice(-100)];
    this.elements = garder;
    const t = `${this.f}.tmp`;
    writeFileSync(t, JSON.stringify(garder.map((e) => ({ ...e, lien: chiffrerChamp(this.home, e.lien) })), null, 1), { mode: 0o600 });
    renameSync(t, this.f);
  }
  ajouter(e: Omit<Element, 'id' | 'etat' | 'ajoute'>, now: Date): Element {
    const x: Element = { ...e, id: randomBytes(5).toString('hex'), etat: 'attente', ajoute: now.toISOString() };
    this.elements.push(x); this.sauver(); return x;
  }
  get(id: string): Element | undefined { return this.elements.find((e) => e.id === id || e.nom === id); }
  maj(id: string, patch: Partial<Element>): void { const e = this.get(id); if (e) { Object.assign(e, patch); this.sauver(); } }
  retirer(id: string): Element | undefined { const e = this.get(id); if (e) { this.elements = this.elements.filter((x) => x !== e); this.sauver(); } return e; }
  /** Les prochains à lancer : en attente, priorité d'abord (la plus haute), puis le plus ancien. */
  suivants(o: { places: number; creusesPermis: boolean }): Element[] {
    if (o.places <= 0) return [];
    return this.elements.filter((e) => e.etat === 'attente' && (!e.creuses || o.creusesPermis))
      .sort((a, b) => b.priorite - a.priorite || a.ajoute.localeCompare(b.ajoute)).slice(0, o.places);
  }
}

/** L'heure « HH:MM » est-elle dans la plage [debut, fin) (qui peut passer minuit) ? Pur. */
export function dansPlage(hhmm: string, plage: { debut: string; fin: string }): boolean {
  const m = (x: string) => { const [h, mi] = x.split(':').map(Number); return h * 60 + (mi || 0); };
  const t = m(hhmm), d = m(plage.debut), f = m(plage.fin);
  return d === f ? true : d < f ? t >= d && t < f : t >= d || t < f;
}
