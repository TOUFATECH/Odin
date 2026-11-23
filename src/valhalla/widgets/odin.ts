// La famille « Odin » des widgets : ce que montre une appli d'Odin, choisie par la personne (ses chiffres, une partie
// de sa page). Un membre ne les reçoit que s'il a le droit sur l'appli ; une tablette « maison », seulement pour une
// appli de la famille « Maison » (la règle de l'écran de la maison d'aujourd'hui).
import type { EtatWidget, SorteWidget } from './sorte.ts';
import { porteUneMesure } from './sorte.ts';

export const SORTES_ODIN = [
  {
    // Les chiffres clés d'une appli (6 au plus).
    id: 'chiffres', famille: 'odin', applis: 'choisie', taille: { mini: [2, 1], r: 2 }, styles: ['simple'], public: 'membre', posable: true,
    nettoyer: (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; },
    lire: async (w, src): Promise<EtatWidget> => {
      const m = w.module ? src.appli(w.module) : undefined;
      if (!m) return { etat: 'source_absente', raison: 'appli_absente' };
      const vw = await src.vue(m.id);
      if (!vw) return { etat: 'source_absente', raison: 'appli_muette' };
      const kpis = (vw.kpis ?? []).slice(0, 6);
      // Que des zéros, des tirets ou des mots (« arrêtée ») : l'appli n'a encore rien mesuré. Jamais un faux chiffre.
      if (!kpis.some((k) => porteUneMesure(k.value))) return { etat: 'vide', raison: 'rien_mesure' };
      return { etat: 'ok', at: src.maintenant(), donnee: { appli: m.id, kpis } };
    },
  },
  {
    // Une partie de la page d'une appli (une table, une liste…), retrouvée par son titre (comme aujourd'hui).
    id: 'section', famille: 'odin', applis: 'choisie', taille: { mini: [3, 2], r: 3 }, styles: ['simple'], public: 'membre', posable: true,
    nettoyer: (o, out, t) => { out.section = t.str(o.section, 80); if (!out.section) return false; if (o.label) out.label = t.str(o.label, 40); return true; },
    lire: async (w, src): Promise<EtatWidget> => {
      const m = w.module ? src.appli(w.module) : undefined;
      if (!m) return { etat: 'source_absente', raison: 'appli_absente' };
      if (!w.section) return { etat: 'vide', raison: 'partie_non_choisie' };
      const vw = await src.vue(m.id);
      if (!vw) return { etat: 'source_absente', raison: 'appli_muette' };
      const sec = [...vw.sections, ...(vw.side ?? [])].find((x) => x.title === w.section && x.kind !== 'form' && x.kind !== 'graph');
      if (!sec) return { etat: 'vide', raison: 'partie_introuvable' };
      const lignes = (sec as { rows?: unknown[]; items?: unknown[] }).rows ?? (sec as { items?: unknown[] }).items;
      if (Array.isArray(lignes) && !lignes.length) return { etat: 'vide', raison: 'partie_vide' };
      return { etat: 'ok', at: src.maintenant(), donnee: { appli: m.id, section: sec } };
    },
  },
] as const satisfies readonly SorteWidget[];
