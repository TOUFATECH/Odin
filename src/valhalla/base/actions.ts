// Alexandrie — les actions de la base d'Odin (les données des applis) : son état, sauvegarder maintenant, restaurer
// une sauvegarde à côté, remettre une appli en fichiers (retour) ou la repasser dans la base.
// Pour la lire, Odin passe par « Lancer du SQL » sur la base « odin » (compte de lecture : les vues seulement).
import type { Action } from '../types.ts';
import { baseOdin, lesMigrables, LECTURE } from './index.ts';
import { restaurerACote, sauvegardes, sauvegarder } from './sauvegarde.ts';

const s = (v: unknown) => String(v ?? '').trim();
const mo = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n > 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} ko`);
const appli = (q: unknown) => { const k = s(q).toLowerCase(); const m = lesMigrables().find((x) => x.id === k || x.nom.toLowerCase() === k); if (!m) throw new Error(`appli inconnue : ${s(q)} (dans la base : ${lesMigrables().map((x) => x.nom).join(', ') || 'aucune'})`); return m; };

export const ACTIONS_BASE: Action[] = [
  { id: 'base_odin', label: 'État de la base d\'Odin', what: 'Où sont rangées les données des applis (base PostgreSQL d\'Odin ou fichiers), ce qui attend, les sauvegardes', read: true, words: ['etat de la base d odin', 'base d odin', 'donnees des applis'],
    run: (ctx) => {
      const b = baseOdin(), l = sauvegardes(ctx.home);
      if (!b) return { text: 'La base d\'Odin n\'est pas démarrée (Odin lancé sans elle, ou ODIN_BASE=non) : les applis rangent leurs données en fichiers.' };
      const apps = lesMigrables().map((m) => { const e = m.etat(); return `- ${m.nom} : ${e.message}`; });
      return { text: [b.message, ...(b.cible ? [`Lecture par Odin : base « odin » d'Alexandrie, compte ${LECTURE} (les vues v_* seulement).`] : []), 'Applis :', ...(apps.length ? apps : ['- aucune pour l\'instant']), l.length ? `Sauvegardes chiffrées : ${l.length}, la dernière le ${l[0].date.slice(0, 16).replace('T', ' à ')} (${mo(l[0].octets)}).` : 'Pas encore de sauvegarde chiffrée (une par nuit).'].join('\n'), data: { etat: b.etat, applis: lesMigrables().map((m) => ({ id: m.id, ...m.etat() })), sauvegardes: l.length } };
    } },
  { id: 'base_sauvegarder', label: 'Sauvegarder la base d\'Odin', what: 'Une sauvegarde chiffrée de la base d\'Odin maintenant (relue avant d\'être gardée)', words: ['sauvegarde la base d odin'],
    run: async (ctx) => { const b = baseOdin(); if (!b) return { ok: false, text: 'La base d\'Odin n\'est pas démarrée.' }; const r = await sauvegarder(b, ctx.now()); return { text: `💾 Sauvegarde chiffrée faite et relue (${r.elements} éléments, ${mo(r.octets)}).` }; } },
  { id: 'base_restaurer', label: 'Restaurer la base d\'Odin à côté', what: 'Remet une sauvegarde chiffrée dans une NOUVELLE base à côté (la base d\'Odin n\'est pas touchée)', params: [{ key: 'date', label: 'Sauvegarde (date, vide = la dernière)', kind: 'text' }],
    grave: (i) => `créer une nouvelle base à côté avec la sauvegarde ${s(i.date) || 'la plus récente'}`,
    run: async (ctx, i) => {
      const b = baseOdin(); if (!b) return { ok: false, text: 'La base d\'Odin n\'est pas démarrée.' };
      const l = sauvegardes(ctx.home), x = s(i.date) ? l.find((y) => y.date.startsWith(s(i.date))) : l[0]; if (!x) return { ok: false, text: 'Aucune sauvegarde ne correspond : « état de la base d\'Odin » les liste.' };
      const nom = await restaurerACote(b, x.fichier, ctx.now()); return { text: `↩ Sauvegarde du ${x.date.slice(0, 16).replace('T', ' à ')} remise dans la base « ${nom} » (à côté : la base d'Odin n'a pas bougé).` };
    } },
  { id: 'base_retour', label: 'Remettre une appli en fichiers', what: 'Les données de l\'appli quittent la base d\'Odin pour des fichiers (elles restent aussi dans la base)', params: [{ key: 'appli', label: 'Appli (ex. Pégase)', kind: 'text', required: true }],
    grave: (i) => `remettre les données de ${s(i.appli)} en fichiers (la base n'est plus tenue à jour pour cette appli)`,
    run: async (_ctx, i) => ({ text: await appli(i.appli).retour() }) },
  { id: 'base_repasser', label: 'Repasser une appli dans la base', what: 'Les données d\'une appli revenue en fichiers repassent dans la base d\'Odin', params: [{ key: 'appli', label: 'Appli (ex. Pégase)', kind: 'text', required: true }],
    run: async (_ctx, i) => ({ text: await appli(i.appli).repasser() }) },
];
