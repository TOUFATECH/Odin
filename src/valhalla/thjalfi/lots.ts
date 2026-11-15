// Genèse · les notifications regroupées : quand vingt postes démarrent, finissent ou ratent presque ensemble,
// Odin ne sonne pas vingt fois.
//   - La première notification d'un genre (début, réussite, échec, abandon, poste inconnu) part tout de suite.
//   - Les suivantes du même genre, tant qu'il en arrive (30 s sans rien, 5 min au plus), sont gardées puis
//     envoyées en UNE seule : « ❌ 19 autres installations ratées : pc-2, pc-3, pc-4 et 16 autres ».
//   - Le détail poste par poste reste dans le fil de Genèse (journal « thjalfi_etapes ») et dans la page.
import type { AlertIn, Level } from '../types.ts';

export type Genre = 'début' | 'fini' | 'échec' | 'abandon' | 'inconnu';
export const LOT_MS = 30_000;
export const LOT_MAX_MS = 5 * 60_000;
const RANG: Record<Level, number> = { info: 0, moyenne: 1, haute: 2, critique: 3 };
const TITRES: Record<Genre, (n: number) => string> = {
  'début': (n) => `▶ ${n} autres installations ont démarré`,
  fini: (n) => `✅ ${n} autres installations terminées`,
  'échec': (n) => `❌ ${n} autres installations ratées`,
  abandon: (n) => `❔ ${n} autres installations abandonnées (plus de signe de vie)`,
  inconnu: (n) => `🆕 ${n} autres postes inconnus au démarrage réseau`,
};
/** « a, b, c et 16 autres ». Pur. */
export const quelquesNoms = (noms: string[], max = 3) => (noms.length <= max ? noms.join(', ') : `${noms.slice(0, max).join(', ')} et ${noms.length - max} autre${noms.length - max > 1 ? 's' : ''}`);

/** Une seule notification pour tout ce qui a été gardé. Pur. */
export function grouper(genre: Genre, debut: number, l: Array<{ nom: string; alerte: AlertIn }>): AlertIn {
  if (l.length === 1) return l[0].alerte;
  const niveau = l.map((x) => x.alerte.level).sort((a, b) => RANG[b] - RANG[a])[0], noms = [...new Set(l.map((x) => x.nom))];
  const details = l.slice(0, 6).map((x) => `${x.nom} : ${x.alerte.detail ?? x.alerte.title}`);
  return { level: niveau, title: `${TITRES[genre](l.length)} : ${quelquesNoms(noms)}`, detail: `${details.join('\n')}${l.length > 6 ? `\n… et ${l.length - 6} de plus : le détail est dans Genèse (onglets Installations et Historique).` : ''}`, key: `thjalfi-lot-${genre}-${debut}`, ...(l[0].alerte.steps ? { steps: l[0].alerte.steps } : {}) };
}

interface Lot { debut: number; dernier: number; cles: Set<string>; garde: Array<{ nom: string; alerte: AlertIn }>; minuteur?: ReturnType<typeof setTimeout> }
export class Lots {
  private ouverts = new Map<Genre, Lot>();
  private envoyer: (a: AlertIn) => void;
  constructor(envoyer: (a: AlertIn) => void) { this.envoyer = envoyer; }
  /** Une notification à envoyer : tout de suite si c'est la première de son genre, sinon avec les autres. `now` : l'horloge d'Odin. */
  dire(genre: Genre, nom: string, alerte: AlertIn, now: number): void {
    this.vider(now);
    const cle = alerte.key ?? alerte.title; let lot = this.ouverts.get(genre);
    if (!lot) { lot = { debut: now, dernier: now, cles: new Set([cle]), garde: [] }; this.ouverts.set(genre, lot); this.armer(genre, lot); this.envoyer(alerte); return; }
    // La même notification encore une fois (un poste qui tourne en boucle) : Odin la compte déjà lui-même.
    if (lot.cles.has(cle)) { this.envoyer(alerte); return; }
    lot.cles.add(cle); lot.garde.push({ nom, alerte }); lot.dernier = now; this.armer(genre, lot);
  }
  /** Envoie ce qui a assez attendu (appelé à chaque notification, et chaque minute par la surveillance). */
  vider(now: number, tout = false): void {
    for (const [genre, lot] of [...this.ouverts]) {
      if (!tout && now - lot.dernier < LOT_MS && now - lot.debut < LOT_MAX_MS) continue;
      this.ouverts.delete(genre); if (lot.minuteur) clearTimeout(lot.minuteur);
      if (lot.garde.length) this.envoyer(grouper(genre, lot.debut, lot.garde));
    }
  }
  /** Sans attendre la surveillance : le lot part 30 s après sa dernière notification. */
  private armer(genre: Genre, lot: Lot): void {
    if (lot.minuteur) clearTimeout(lot.minuteur);
    lot.minuteur = setTimeout(() => { if (this.ouverts.get(genre) !== lot) return; this.ouverts.delete(genre); if (lot.garde.length) { try { this.envoyer(grouper(genre, lot.debut, lot.garde)); } catch { /* Odin s'arrête */ } } }, LOT_MS);
    lot.minuteur.unref?.();
  }
  /** Odin s'arrête : plus de minuteur (ce qui attendait n'est pas envoyé). */
  fermer(): void { for (const lot of this.ouverts.values()) if (lot.minuteur) clearTimeout(lot.minuteur); this.ouverts.clear(); }
}
