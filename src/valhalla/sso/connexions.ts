// Persona — le journal des connexions (qui s'est connecté, d'où, les échecs) : dans la base d'Odin dès qu'elle est
// prête (schéma « journaux », 500 dernières en mémoire) ; sinon dans les réglages de Persona, comme avant.
// Les personnes, leurs empreintes de mots de passe et leurs sessions restent dans le fichier bloqué de Persona :
// il faut pouvoir se connecter avant que la base existe, et ce sont des secrets.
import { Journal } from '../base/journal.ts';
import type { ModCtx } from '../types.ts';

export interface Connexion { t: number; login: string; ip: string; ok: boolean; why: string }
const journaux = new WeakMap<ModCtx, Journal<Connexion>>();
/** Le journal des connexions de Persona (un par dossier d'Odin). */
export function connexions(ctx: ModCtx): Journal<Connexion> {
  let j = journaux.get(ctx); if (j) return j;
  const lire = () => (ctx.settings.journal as Connexion[] | undefined) ?? [];
  j = new Journal<Connexion>('connexions', ctx.dir, {
    garder: 500, quand: (e) => e.t,
    rangement: { lire, ajouter: (e) => ctx.saveSettings({ journal: [...lire(), e].slice(-500) }), vider: () => ctx.saveSettings({ journal: undefined }), reecrire: (l) => ctx.saveSettings({ journal: l.slice(-500) }) },
  });
  journaux.set(ctx, j); return j;
}
