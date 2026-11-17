// L'initiative de Kéryx : il peut t'écrire LE PREMIER, selon ce que tu l'autorises à surveiller. En attendant Prónoia
// (le réseau qui jugera ce qui mérite de déranger), des règles simples : rappeler un rendez-vous qui approche, et
// signaler un mail marqué important. L'envoi passe par le propriétaire (gw.notifyOwner) et respecte les heures calmes
// (gw.quietNow). Rien n'est répété : une même chose n'est signalée qu'une fois.

import { agendaOdin, type ElementAgenda } from '../automatismes.ts';
import { tracer } from './trace.ts';
import type { ReglagesKeryx, Surveillance } from './types.ts';

/** Juste ce qu'il faut de la passerelle : prévenir le propriétaire, et savoir s'il faut rester calme. */
export interface PasserelleProactif {
  notifyOwner(texte: string, o?: { urgent?: boolean }): Promise<void>;
  quietNow(now?: number): string | undefined;
}

/** Combien de minutes avant un rendez-vous prévenir (lu dans le réglage de la surveillance, défaut 30). */
export function minutesAvant(s: Surveillance): number {
  const n = Number(s.reglage.replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1440) : 30;
}

/** Les rendez-vous qui tombent dans la fenêtre [now, now + avantMin] (pur, testable). */
export function rdvImminents(items: ElementAgenda[], now: number, avantMin: number): ElementAgenda[] {
  const fin = now + avantMin * 60_000;
  // Seuls les RENDEZ-VOUS : l'agenda d'Odin contient aussi les tâches de Talos, qui ne sont pas à rappeler.
  return items.filter((e) => { const t = Date.parse(e.quand); return e.sorte === 'rendez_vous' && Number.isFinite(t) && t >= now && t <= fin; });
}

/** Surveille et prévient. Garde en mémoire ce qui a déjà été dit pour ne pas répéter. */
export class Proactif {
  private dejaDit = new Set<string>();
  private readonly gw: PasserelleProactif;
  private readonly reglages: () => ReglagesKeryx;
  constructor(gw: PasserelleProactif, reglages: () => ReglagesKeryx) { this.gw = gw; this.reglages = reglages; }

  /** Un passage : regarde les surveillances actives et prévient si besoin (sauf en heures calmes). */
  async passer(now = Date.now()): Promise<number> {
    const r = this.reglages();
    let envoyes = 0;
    for (const s of r.surveillances.filter((x) => x.actif)) {
      if (s.quoi === 'rappel_rdv') {
        const av = minutesAvant(s);
        const items = agendaOdin(new Date(now), new Date(now + av * 60_000));
        for (const e of rdvImminents(items, now, av)) {
          const clef = `rdv:${e.quand}:${e.titre}`;
          if (this.dejaDit.has(clef)) continue;
          // Un rappel n'est pas urgent : il attend les heures calmes. On ne marque PAS « déjà dit » pour l'instant, sinon
          // il serait perdu à jamais — on le retentera au prochain passage, une fois les heures calmes terminées.
          if (this.gw.quietNow(now)) continue;
          let ok = true;
          await this.gw.notifyOwner(`⏰ Rendez-vous bientôt : « ${e.titre} » ${e.quandTexte}.`).catch(() => { ok = false; });
          if (!ok) continue; // échec d'envoi : on réessaiera, donc on ne le note pas comme dit
          this.dejaDit.add(clef);
          await tracer({ quand: new Date(now).toISOString(), canal: 'keryx', pair: 'propriétaire', sens: 'sortant', texte: `rappel : ${e.titre}` }).catch(() => {});
          envoyes++;
        }
      }
      // mail_important : branché plus tard sur le courrier (ici, rien à surveiller sans source) — règle posée.
    }
    return envoyes;
  }

  /** Oublie ce qui a été signalé (essais, nouveau jour). */
  reinitialiser(): void { this.dejaDit.clear(); }
}
