// La base d'Odin au lancement d'Odin : préparée en arrière-plan (Odin n'attend pas), surveillée, sauvegardée chaque
// nuit (chiffrée). Son état va dans le fil d'alertes (Alexandrie) : « pas prête », « de nouveau prête ».
// `ODIN_BASE=non` : pas de base (les applis restent en fichiers).
import type { Valhalla } from '../service.ts';
import { BaseOdin, utiliserBase } from './index.ts';
import { cleSauvegardes, sauvegardes, sauvegarder } from './sauvegarde.ts';

export function demarrerBaseOdin(home: string, v?: Valhalla, o: { log?: (t: string) => void } = {}): () => Promise<void> {
  if (/^(non|0|false|off)$/i.test(process.env.ODIN_BASE ?? '')) return async () => {};
  const log = o.log ?? ((t: string) => console.log(`[base] ${t}`));
  const ctx = v?.ctx('urdr');
  const coffre = ctx ? async (nom: string, identifiant: string, mdp: string, site: string) => {
    const r = await ctx.call('brisingamen', 'ajouter', { nom, identifiant, mot_de_passe: mdp, site, coffre: 'TOUFATECH' }, 'ranger le mot de passe de la base d\'Odin', { interne: true });
    if (r.ok === false) throw new Error(r.text);
  } : undefined;
  const b = new BaseOdin(home, { coffre, log });
  let vue = 0;
  b.on('etat', (etat: string, message: string) => {
    if (!ctx) return;
    if (etat === 'prete') { if (vue) ctx.alert({ level: 'info', title: 'Base d\'Odin de nouveau prête', detail: message, key: 'base:etat' }); vue = 0; }
    else { vue ||= Date.now(); ctx.alert({ level: etat === 'perdue' ? 'haute' : 'moyenne', title: 'Base d\'Odin pas prête', detail: message, steps: ['Odin marche quand même : les écritures des applis attendent sur le disque.', 'Regarde l\'état de la base dans Alexandrie (« état de la base d\'Odin »).', 'PostgreSQL de la machine : « systemctl status postgresql ».'], key: 'base:etat' }); }
  });
  utiliserBase(b);
  void b.demarrer();
  // Chaque heure : une sauvegarde chiffrée si la dernière a plus d'un jour.
  const nuit = setInterval(() => {
    const l = sauvegardes(home)[0];
    if (b.etat !== 'prete' || (l && Date.now() - Date.parse(l.date) < 23 * 3600_000)) return;
    void (async () => {
      const k = cleSauvegardes(home);
      if (k.nouvelle && coffre) await coffre('Clé des sauvegardes de la base d\'Odin', 'odin', k.cle, 'sauvegardes chiffrées (valhalla/urdr/sauvegardes/odin)').catch(() => undefined);
      const r = await sauvegarder(b); log(`sauvegarde chiffrée : ${r.fichier} (${r.elements} éléments relus)`);
    })().catch((e) => ctx?.alert({ level: 'moyenne', title: 'Base d\'Odin : sauvegarde en échec', detail: (e as Error).message, key: 'base:sauvegarde' }));
  }, 3600_000);
  nuit.unref?.();
  return async () => { clearInterval(nuit); utiliserBase(undefined); await b.arreter(); };
}
