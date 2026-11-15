// Alexandrie — les actions de la base d'Odin (les données des applis) : son état, sauvegarder maintenant, restaurer
// une sauvegarde à côté, remettre une appli en fichiers (retour) ou la repasser dans la base.
// Une base par appli (PEGASE_ODIN, PERSONA_ODIN… : noms.ts). Odin lit la base d'une appli par « Lire la base d'une
// appli » (compte de lecture : les vues seulement, lecture seule, secrets masqués, chaque lecture tracée et retenue).
import type { Action } from '../types.ts';
import { baseOdin, lesMigrables, LECTURE, nomDeLaBase, nomsGardes } from './index.ts';
import { restaurerACote, sauvegardes, sauvegarder } from './sauvegarde.ts';
import { appliDeNom, nomAffiche, nomBase } from './noms.ts';
import { applisConnues, RAISONS, resume } from './inventaire.ts';
import { lireBaseAppli, texteLecture } from './lecture.ts';
import { traces } from './trace.ts';

const s = (v: unknown) => String(v ?? '').trim();
const mo = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n > 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} ko`);
const appli = (q: unknown) => { const k = s(q).toLowerCase(); const m = lesMigrables().find((x) => x.id === k || x.nom.toLowerCase() === k); if (!m) throw new Error(`appli inconnue : ${s(q)} (dans la base : ${lesMigrables().map((x) => x.nom).join(', ') || 'aucune'})`); return m; };

export const ACTIONS_BASE: Action[] = [
  { id: 'base_odin', label: 'État de la base d\'Odin', what: 'Où sont rangées les données des applis (base PostgreSQL d\'Odin ou fichiers), ce qui attend, les sauvegardes', read: true, words: ['etat de la base d odin', 'base d odin', 'donnees des applis'],
    run: (ctx) => {
      const b = baseOdin(), l = sauvegardes(ctx.home);
      if (!b) return { text: 'La base d\'Odin n\'est pas démarrée (Odin lancé sans elle, ou ODIN_BASE=non) : les applis rangent leurs données en fichiers.' };
      const apps = lesMigrables().map((m) => { const e = m.etat(); return `- ${m.nom} : ${e.message}`; });
      return { text: [b.message, ...(b.cible ? [`Une base par appli (${b.basesDesApplis().join(', ') || 'aucune pour l\'instant'}). Lecture par Odin : compte ${LECTURE} (les vues v_* seulement).`] : []), 'Applis :', ...(apps.length ? apps : ['- aucune pour l\'instant']), l.length ? `Sauvegardes chiffrées : ${l.length}, la dernière le ${l[0].date.slice(0, 16).replace('T', ' à ')} (${mo(l[0].octets)}).` : 'Pas encore de sauvegarde chiffrée (une par nuit).'].join('\n'), data: { etat: b.etat, applis: lesMigrables().map((m) => ({ id: m.id, ...m.etat() })), sauvegardes: l.length } };
    } },
  { id: 'base_sauvegarder', label: 'Sauvegarder la base d\'Odin', what: 'Une sauvegarde chiffrée de la base d\'Odin maintenant (relue avant d\'être gardée)', words: ['sauvegarde la base d odin'],
    run: async (ctx) => { const b = baseOdin(); if (!b) return { ok: false, text: 'La base d\'Odin n\'est pas démarrée.' }; const r = await sauvegarder(b, ctx.now()); return { text: `💾 Sauvegarde chiffrée faite et relue : ${r.bases.join(', ')} (${r.elements} éléments, ${mo(r.octets)}).` }; } },
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
  { id: 'base_lire', label: 'Lire la base d\'une appli', what: 'Odin regarde la base d\'une appli (trouvée par son nom : Phénix → PHENIX_ODIN) en lecture seule : sans requête, ce qu\'il peut y lire ; avec une requête SELECT, son résultat (200 lignes au plus, secrets masqués). Chaque lecture est notée et retenue', read: true, quick: false,
    params: [{ key: 'appli', label: 'Appli (ex. Phénix)', kind: 'text', required: true }, { key: 'requete', label: 'Requête SELECT (vide = ce qu\'il y a dans la base)', kind: 'textarea', default: '' }, { key: 'pourquoi', label: 'Pourquoi (noté dans la trace)', kind: 'text', default: '' }],
    run: async (ctx, i) => {
      const r = await lireBaseAppli(ctx.home, { appli: s(i.appli), requete: s(i.requete) || undefined, pourquoi: s(i.pourquoi) || undefined, qui: 'Odin (discussion)', quand: ctx.now() });
      return { text: texteLecture(r), data: r };
    } },
  { id: 'base_traces', label: 'Liens d\'Odin avec les bases', what: 'Quand Odin a lu, écrit, migré, déménagé ou renommé la base d\'une appli : qui, quelle base, quelles tables, pourquoi (jamais les valeurs)', read: true, quick: false,
    params: [{ key: 'appli', label: 'Appli (vide = toutes)', kind: 'text', default: '' }],
    run: (ctx, i) => {
      const a = s(i.appli) ? appliDeNom(s(i.appli)) : undefined; if (s(i.appli) && !a) return { ok: false, text: `Appli inconnue : ${s(i.appli)}.` };
      const l = traces(ctx.home, { appli: a, n: 40 });
      return { text: l.length ? l.map((t) => `- ${t.at.slice(0, 16).replace('T', ' ')} · ${t.op} · ${t.base}${t.tables.length ? ` (${t.tables.join(', ')})` : ''} · ${t.qui}${t.pourquoi ? ` · ${t.pourquoi}` : ''}${t.lignes !== undefined ? ` · ${t.lignes} ligne(s)` : ''}${t.ok === false ? ' · ÉCHEC' : ''}`).join('\n') : `Odin n'a encore rien noté pour ${a ? `la base de ${nomAffiche(a)}` : 'les bases des applis'}.`, data: l };
    } },
  { id: 'base_inventaire', label: 'Où sont les données des applis', what: 'Pour chaque appli : le nom de sa base (NOM_ODIN), ce qui est déjà dans la base, ce qui reste en fichier et pourquoi', read: true, quick: false,
    params: [{ key: 'appli', label: 'Appli (vide = toutes)', kind: 'text', default: '' }],
    run: (ctx, i) => {
      const a = s(i.appli) ? appliDeNom(s(i.appli)) : undefined; if (s(i.appli) && !a) return { ok: false, text: `Appli inconnue : ${s(i.appli)}.` };
      const l = (a ? [a] : applisConnues()).map((id) => ({ id, ...resume(id), base: nomDeLaBase(ctx.home, id) }));
      return { text: l.map((x) => `- ${nomAffiche(x.id)} → ${x.base} : ${x.enBase.length ? `en base : ${x.enBase.map((r) => r.donnees).join(', ')}` : 'rien en base'}${x.enFichiers.length ? ` ; en fichiers : ${x.enFichiers.map((r) => `${r.donnees} (${RAISONS[r.raison ?? 'reglages']})`).join(', ')}` : ''}`).join('\n'), data: l };
    } },
  { id: 'base_renommer', label: 'Renommer la base d\'une appli', what: 'Renomme la base d\'une appli et son compte (données intactes) ; vide = remettre le nom de la règle (NOM_ODIN), « ancien » = revenir au nom précédent', params: [{ key: 'appli', label: 'Appli (ex. Pégase)', kind: 'text', required: true }, { key: 'nom', label: 'Nouveau nom (vide = NOM_ODIN, « ancien » = nom précédent)', kind: 'text', default: '' }],
    grave: (i) => `renommer la base de ${s(i.appli)}${s(i.nom) ? ` en ${s(i.nom)}` : ' selon la règle NOM_ODIN'} (les connexions de l'appli sont coupées un instant)`,
    run: async (ctx, i) => {
      const b = baseOdin(); if (!b) return { ok: false, text: 'La base d\'Odin n\'est pas démarrée.' };
      const a = appliDeNom(s(i.appli)); if (!a) return { ok: false, text: `Appli inconnue : ${s(i.appli)}.` };
      const g = nomsGardes(ctx.home)[a], voulu = s(i.nom).toLowerCase() === 'ancien' ? g?.precedent : s(i.nom) || nomBase(a);
      if (!voulu) return { ok: false, text: `La base de ${nomAffiche(a)} n'a pas d'ancien nom connu.` };
      return { text: await b.renommer(a, voulu, { garder: voulu !== nomBase(a), pourquoi: `demande du propriétaire : ${g?.nom ?? nomBase(a)} → ${voulu}` }) };
    } },
];
