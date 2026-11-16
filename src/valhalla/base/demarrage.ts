// La base d'Odin au lancement d'Odin : préparée en arrière-plan (Odin n'attend pas), surveillée, sauvegardée chaque
// nuit (chiffrée). Son état va dans le fil d'alertes (Alexandrie) : « pas prête », « de nouveau prête ».
// `ODIN_BASE=non` : pas de base (les applis restent en fichiers).
import type { Valhalla } from '../service.ts';
import { BaseOdin, baseOdin, utiliserBase } from './index.ts';
import { cleSauvegardes, sauvegardes, sauvegarder } from './sauvegarde.ts';
import { tacheEnPause } from '../automatismes.ts';

// `base` : la base déjà préparée au démarrage pour lire les réglages (reglages-base.ts) : elle est reprise, pas recréée.
export function demarrerBaseOdin(home: string, v?: Valhalla, o: { log?: (t: string) => void; base?: BaseOdin } = {}): () => Promise<void> {
  if (!o.base && /^(non|0|false|off)$/i.test(process.env.ODIN_BASE ?? '')) return async () => {};
  const log = o.log ?? ((t: string) => console.log(`[base] ${t}`));
  const ctx = v?.ctx('urdr');
  const coffre = ctx ? async (nom: string, identifiant: string, mdp: string, site: string) => {
    const r = await ctx.call('brisingamen', 'ajouter', { nom, identifiant, mot_de_passe: mdp, site, coffre: 'TOUFATECH' }, 'ranger le mot de passe de la base d\'Odin', { interne: true });
    if (r.ok === false) throw new Error(r.text);
  } : undefined;
  const b = o.base ?? new BaseOdin(home, { coffre, log });
  if (o.base) o.base.regler({ coffre, log });
  let vue = 0;
  const surEtat = (etat: string, message: string) => {
    if (!ctx) return;
    if (etat === 'prete') { if (vue) ctx.alert({ level: 'info', title: 'Base d\'Odin de nouveau prête', detail: message, key: 'base:etat' }); vue = 0; }
    else { vue ||= Date.now(); ctx.alert({ level: etat === 'perdue' ? 'haute' : 'moyenne', title: 'Base d\'Odin pas prête', detail: message, steps: ['Odin marche quand même : les écritures des applis attendent sur le disque.', 'Regarde l\'état de la base dans Alexandrie (« état de la base d\'Odin »).', 'PostgreSQL de la machine : « systemctl status postgresql ».'], key: 'base:etat' }); }
  };
  b.on('etat', surEtat);
  if (baseOdin() !== b) utiliserBase(b);
  // Base reprise : elle tourne déjà (son état « pas prête » a pu être annoncé avant que les alertes existent).
  if (o.base) { if (b.etat === 'absente' || b.etat === 'perdue') surEtat(b.etat, b.message); }
  else void b.demarrer();
  // Chaque heure : une sauvegarde chiffrée si la dernière a plus d'un jour. Visible dans Talos (tâche d'Alexandrie :
  // lancer maintenant, pause), une seule à la fois.
  let enCours: Promise<string> | undefined;
  const faire = (): Promise<string> => {
    if (enCours) return enCours;
    enCours = (async () => {
      if (b.etat !== 'prete') throw new Error('La base d\'Odin n\'est pas prête : sauvegarde remise à plus tard.');
      const k = cleSauvegardes(home);
      if (k.nouvelle && coffre) await coffre('Clé des sauvegardes de la base d\'Odin', 'odin', k.cle, 'sauvegardes chiffrées (valhalla/urdr/sauvegardes/odin)').catch(() => undefined);
      const r = await sauvegarder(b), t = `Sauvegarde chiffrée de ${r.bases.join(', ')} (${r.elements} éléments relus).`; log(t); return t;
    })().finally(() => { enCours = undefined; });
    return enCours;
  };
  const nuit = setInterval(() => {
    const l = sauvegardes(home)[0];
    if (b.etat !== 'prete' || (l && Date.now() - Date.parse(l.date) < 23 * 3600_000) || tacheEnPause('urdr', 'sauvegarde_base')) return;
    void faire().catch((e) => ctx?.alert({ level: 'moyenne', title: 'Base d\'Odin : sauvegarde en échec', detail: (e as Error).message, key: 'base:sauvegarde' }));
  }, 3600_000);
  nuit.unref?.();
  v?.automatismes.inscrire('urdr', {
    id: 'sauvegarde_base', nom: 'Sauvegarde chiffrée de la base d\'Odin', quoi: 'Chaque jour : la base d\'Odin sauvegardée, chiffrée et relue (valhalla/urdr/sauvegardes/odin).',
    rythme: () => ({ genre: 'libre', texte: 'Une fois par jour (vérifié chaque heure)' }),
    lancer: { action: 'sauvegarde_base' },
    dernier: () => { const l = sauvegardes(home)[0]; return l ? { at: new Date(Date.parse(l.date)).toISOString() } : undefined; },
    prochain: (_c, now) => { const l = sauvegardes(home)[0]; return new Date(Math.max(now.getTime() + 60_000, l ? Date.parse(l.date) + 23 * 3600_000 : now.getTime() + 3600_000)); },
    faire: async () => ({ text: await faire() }),
  });
  return async () => { clearInterval(nuit); utiliserBase(undefined); await b.arreter(); };
}
