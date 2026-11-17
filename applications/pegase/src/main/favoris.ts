// Favoris (collection « favoris ») : tuiles en haut de la barre de côté, dossiers, page pegase://favoris.
import type { Favori } from '../commun/types';
import type { ProfilOuvert } from './profil';
import { nouvelId } from './outils';

export function actionFavoris(p: ProfilOuvert, action: string, arg: any): { fait: boolean; r?: unknown } {
  const tous = () => p.favoris();
  switch (action) {
    case 'favoris': return { fait: true, r: tous() };
    case 'basculerFavori': {
      const url = String(arg?.url || ''); if (!/^(https?|pegase):/.test(url)) return { fait: true, r: null };
      const deja = tous().find((f) => f.type === 'favori' && f.url === url);
      if (deja && !arg.forcer) { p.suppr('favoris', deja.id); return { fait: true, r: 'retire' }; }
      if (deja) { p.mettre('favoris', { ...deja, tuile: true }); return { fait: true, r: 'ajoute' }; }
      const ordre = (tous().at(-1)?.ordre ?? 0) + 1;
      p.mettre<Favori>('favoris', { id: nouvelId('f'), type: 'favori', nom: String(arg.nom || url).slice(0, 300), url, icone: typeof arg.icone === 'string' && arg.icone.length < 4000 ? arg.icone : undefined, tuile: true, ordre });
      return { fait: true, r: 'ajoute' };
    }
    case 'supprFavori': { const id = String(arg?.id); for (const f of tous()) if (f.dossier === id) p.suppr('favoris', f.id); p.suppr('favoris', id); return { fait: true }; }
    case 'tuileFavori': { const f = tous().find((x) => x.id === arg?.id); if (f) p.mettre('favoris', { ...f, tuile: !f.tuile }); return { fait: true }; }
    case 'favoriFin': { const f = tous().find((x) => x.id === arg?.id); if (f) p.mettre('favoris', { ...f, ordre: (tous().at(-1)?.ordre ?? 0) + 1 }); return { fait: true }; }
    case 'majFavori': {
      const f = tous().find((x) => x.id === arg?.id); if (!f) return { fait: true };
      const n: Favori = { ...f };
      if (arg.nom) n.nom = String(arg.nom).slice(0, 300);
      if ('dossier' in arg) n.dossier = arg.dossier || undefined;
      p.mettre('favoris', n); return { fait: true };
    }
    case 'dossierFavori': { const d: Favori = { id: nouvelId('fd'), type: 'dossier', nom: String(arg?.nom || 'Dossier').slice(0, 120), url: '', ordre: (tous().at(-1)?.ordre ?? 0) + 1, dossier: arg?.parent || undefined }; p.mettre('favoris', d); return { fait: true, r: d.id }; }
  }
  return { fait: false };
}
