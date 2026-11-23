// La famille « Infos » des widgets : l'heure, la météo, un site surveillé. Une tablette « maison » peut les recevoir.
import type { EtatWidget, SorteWidget } from './sorte.ts';

/** Le libellé choisi par la personne : 40 signes (60 pour un site, nommé comme sa sonde). */
const etiquette = (n: number): NonNullable<SorteWidget['nettoyer']> => (o, out, t) => { if (o.label) out.label = t.str(o.label, n); return true; };

export const SORTES_INFOS = [
  {
    // La date, l'heure et le lieu d'Odin (son fuseau). Pas d'appli derrière : le lieu est gardé par Hestia.
    id: 'heure', famille: 'infos', applis: ['gladsheim'], taille: { mini: [2, 1], r: 2 }, styles: ['simple'], public: 'maison', posable: true,
    nettoyer: etiquette(40),
    lire: async (_w, src): Promise<EtatWidget> => {
      const l = src.lieu();
      // Tant que le lieu n'est pas réglé, l'heure serait celle d'un lieu supposé : rien d'affirmé.
      if (!l.choisi) return { etat: 'vide', raison: 'lieu_non_choisi' };
      return { etat: 'ok', at: src.maintenant(), donnee: { lieu: l.nom, fuseau: l.fuseau, heure12: l.heure12 } };
    },
  },
  {
    // Le temps qu'il fait au lieu d'Odin (Open-Meteo, lu par Hestia).
    id: 'meteo', famille: 'infos', applis: ['gladsheim'], taille: { mini: [3, 2], r: 3 }, styles: ['simple'], public: 'maison', posable: true,
    nettoyer: etiquette(40),
    lire: async (_w, src): Promise<EtatWidget> => {
      // Comme l'heure : tant que le lieu n'est pas réglé, ce serait le temps d'un lieu supposé (et une recherche du lieu
      // par défaut sur Internet). Rien d'affirmé, rien de lu.
      if (!src.lieu().choisi) return { etat: 'vide', raison: 'lieu_non_choisi' };
      const m = await src.meteo().catch(() => undefined);
      if (!m) return { etat: 'vide', raison: 'meteo_pas_lue' };
      return m.ancien ? { etat: 'ancien', at: m.at, donnee: m.donnee, motif: m.motif } : { etat: 'ok', at: m.at, donnee: m.donnee };
    },
  },
  {
    // Un site surveillé = une sonde de Pulsar, nommée par `label`. Son adresse n'est donnée qu'au propriétaire.
    // L'appli est gardée dans le widget (`module`), et ce ne peut être que Pulsar.
    id: 'site', famille: 'infos', applis: 'choisie', taille: { mini: [2, 1], r: 2 }, styles: ['simple'], public: 'maison', posable: true,
    nettoyer: (o, out, t) => { if (out.module !== 'vordr' || !t.str(o.label, 60)) return false; out.label = t.str(o.label, 60); return true; },
    lire: async (w, src, l): Promise<EtatWidget> => {
      // Les droits ont été vérifiés sur l'appli du widget : on ne lit Pulsar que si c'est bien elle (jamais une autre).
      if (w.module !== 'vordr' || !src.appli('vordr')) return { etat: 'source_absente', raison: 'appli_absente' };
      if (!w.label) return { etat: 'vide', raison: 'site_non_choisi' };
      const vw = await src.vue('vordr');
      if (!vw) return { etat: 'source_absente', raison: 'appli_muette' };
      // La lecture d'aujourd'hui (celle de l'écran de la maison) : la table « Sondes » de Pulsar, par colonnes.
      const tb = vw.sections.find((x) => x.kind === 'table' && x.title === 'Sondes') as { rows?: Array<{ cells: string[]; tone?: string }> } | undefined;
      const r = tb?.rows?.find((x) => x.cells[0] === w.label);
      if (!r) return { etat: 'vide', raison: 'site_introuvable' };
      return { etat: 'ok', at: src.maintenant(), donnee: { etat: r.cells[3] ?? '', jour: r.cells[4] ?? '', mois: r.cells[5] ?? '', temps: r.cells[6] ?? '', ...(l.qui === 'proprietaire' ? { cible: r.cells[2] ?? '' } : {}), ...(r.tone ? { tone: r.tone } : {}) } };
    },
  },
] as const satisfies readonly SorteWidget[];
