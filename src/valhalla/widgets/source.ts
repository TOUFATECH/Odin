// La source des widgets branchée sur le vrai Odin : ce que « la donnée d'un widget » (index.ts) peut lire. Une source
// par lecture de page : chaque appli n'est lue qu'une fois, même si plusieurs widgets la montrent.
import type { Valhalla } from '../service.ts';
import type { View } from '../types.ts';
import { meteoAncienne, regionActuelle, weather } from '../modules/gladsheim.ts';
import { sitesVeille } from '../modules/idunn.ts';
import { rendezVousAVenir } from '../modules/frigg.ts';
import { history } from '../modules/volva.ts';
import { fuseauOdin } from '../../draupnir/rythme.ts';
import type { SourceWidget } from './sorte.ts';

const s = (v: unknown) => String(v ?? '');

export function sourceOdin(v: Valhalla, maintenant: () => number = Date.now): SourceWidget {
  const vues = new Map<string, Promise<View | null>>();
  let alertes: Array<{ appli: string }> | undefined, aVoir: ReturnType<NonNullable<SourceWidget['alertesAVoir']>> | undefined;
  // Une appli désactivée (Applis) n'est pas là pour un widget.
  const appli = (id: string) => { const m = v.module(id); return m && m.id === id && v.estActive(m.id) ? m : undefined; };
  return {
    appli: (id) => { const m = appli(id); return m ? { id: m.id, name: m.name, family: m.family } : undefined; },
    vue: (id) => {
      const m = appli(id); if (!m) return Promise.resolve(null);
      if (!vues.has(id)) vues.set(id, Promise.resolve().then(() => m.view(v.ctx(id), new URLSearchParams())).catch(() => null));
      return vues.get(id)!;
    },
    action: (id, action, input) => {
      if (!appli(id)) return undefined;
      const f = v.action(id, action); if (!f || f.m.id !== id) return undefined;
      const ctx = v.ctx(f.m.id), seul = typeof f.a.proprietaireSeul === 'function' ? f.a.proprietaireSeul(input, ctx) : f.a.proprietaireSeul === true;
      return { label: f.a.label, grave: Boolean(f.a.grave?.(input, ctx)), proprietaireSeul: seul };
    },
    meteo: async () => {
      const w = await weather(v.ctx('gladsheim')); if (!w) return undefined;
      const a = meteoAncienne();
      return { donnee: { ...w }, at: w.at, ancien: a.ancien, motif: a.motif };
    },
    lieu: () => {
      const g = v.ctx('gladsheim');
      return { choisi: Boolean(s(g.settings.ville)), nom: s(g.settings.villeNom) || s(g.settings.ville), fuseau: s(g.settings.fuseau), heure12: regionActuelle(g).heure === '12h' };
    },
    maintenant,
    // Les alertes pas encore vues, lues comme une appli les lit (le contexte de Hestia, pas le journal entier) : au nom
    // d'un membre, Valhalla retire déjà celles de Sphinx qui ne sont pas de son appareil. Rien que l'appli de chacune.
    alertesNonVues: () => (alertes ??= v.ctx('gladsheim').alerts({ limit: Number.MAX_SAFE_INTEGER }).filter((a) => !a.ack).map((a) => ({ appli: a.module }))),
    // La liste des mêmes alertes : rien que ce qu'elle montre (ni le détail, ni les données d'une alerte).
    alertesAVoir: () => (aVoir ??= v.ctx('gladsheim').alerts({ limit: Number.MAX_SAFE_INTEGER }).filter((a) => !a.ack)
      .map((a) => ({ id: a.id, appli: a.module, nomAppli: v.module(a.module)?.name ?? a.module, titre: s(a.title), niveau: s(a.level), at: Date.parse(a.at) || 0 }))),
    // Les sites d'Arachné, si elle est là et activée.
    sitesVeille: () => (appli('idunn') ? sitesVeille(v.ctx('idunn')) : undefined),
    // Les rendez-vous de Chronos et les recherches de Pythie, si elles sont là et activées (au propriétaire seul : listes.ts).
    rendezVous: () => { if (!appli('frigg')) return undefined; const f = s(v.ctx('gladsheim').settings.fuseau); return { fuseau: fuseauOdin(f), liste: rendezVousAVenir(v.ctx('frigg'), f) }; },
    recherches: () => (appli('volva') ? history(v.ctx('volva')).map((h) => ({ id: s(h.id), q: s(h.q), at: Number(h.at) || 0 })) : undefined),
  };
}
