// La famille « Maison » des widgets : le bouton sur mesure (une action de n'importe quelle appli, d'un geste).
// Une action grave n'est jamais servie à une tablette « maison » ni à un membre ; une action « propriétaire seul »
// n'est servie qu'à lui. Le bouton passe toujours par l'action de l'appli, avec son accord (rien ne change ici).
import type { EtatWidget, SorteWidget } from './sorte.ts';

export const SORTES_MAISON = [
  {
    id: 'bouton', famille: 'maison', applis: 'choisie', taille: { mini: [2, 1], r: 2 }, styles: ['simple'], public: 'maison', posable: true,
    nettoyer: (o, out, t) => {
      out.action = t.str(o.action, 40); out.label = t.str(o.label, 40) || out.action; if (!out.action) return false;
      const inp = (o.input && typeof o.input === 'object' ? o.input : {}) as Record<string, unknown>;
      out.input = Object.fromEntries(Object.entries(inp).slice(0, 12).filter(([k]) => /^[a-z_][a-z0-9_]{0,30}$/i.test(k)).map(([k, v]) => [k, t.str(v, 300)]));
      return true;
    },
    lire: async (w, src, l): Promise<EtatWidget> => {
      const m = w.module ? src.appli(w.module) : undefined;
      if (!m) return { etat: 'source_absente', raison: 'appli_absente' };
      if (!w.action) return { etat: 'vide', raison: 'action_non_choisie' };
      const a = src.action(m.id, w.action, w.input ?? {});
      if (!a) return { etat: 'source_absente', raison: 'action_absente' };
      if (a.grave && l.qui !== 'proprietaire') return { etat: 'refuse', raison: 'action_grave', appli: m.id };
      if (a.proprietaireSeul && l.qui !== 'proprietaire') return { etat: 'refuse', raison: 'proprietaire_seul', appli: m.id };
      return { etat: 'ok', at: src.maintenant(), donnee: { titre: w.label || a.label, appli: m.id, grave: a.grave } };
    },
  },
] as const satisfies readonly SorteWidget[];
