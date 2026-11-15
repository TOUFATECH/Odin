// Satellites · le compagnon d'Odin sur les postes du parc : l'installer (Linux et macOS par SSH, Windows par SSH ou
// WinRM en PowerShell), le retirer, le vérifier ; voir l'état du parc (système exact, mises à jour, failles, analyses) ;
// demander une analyse ou les mises à jour tout de suite ; dire quelque chose à la personne d'un poste (bulle).
// Genèse demande aussi le script d'un poste qu'elle vient d'installer (« compagnon_script »).

import { networkInterfaces } from 'node:os';
import { findMachine, runOnMachine, type Machine } from '../../machines/access.ts';
import { detecterSysteme, essais, executerPs, type Lien } from '../../machines/windows.ts';
import { adresseOdin } from '../sso/registre.ts';
import type { Action, ActionResult, ModCtx, Param, Section } from '../types.ts';
import { reglages } from './api.ts';
import {
  bulle, desinscrire, empreinteOdin, fiche, inscrire, inscrits, lireEtat, modifierFiche, propre, scriptEtatPosix, scriptEtatWindows, scriptInstallationPosix, scriptInstallationWindows,
  scriptRetraitPosix, scriptRetraitWindows, type SystemePoste,
} from './compagnon.ts';

const s = (v: unknown) => String(v ?? '').trim();
const quand = (t?: number) => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais');
const lanIp = () => Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';
/** L'adresse d'Odin vue des postes : donnée, retenue, ou celle de la machine d'Odin sur le réseau. */
export function adressePourPostes(ctx: ModCtx, donnee = ''): string {
  const a = (s(donnee) || s(ctx.settings.odinUrl)).replace(/\/+$/, ''); if (a) return a;
  const w = adresseOdin(); return `${w.tls ? 'https' : 'http'}://${lanIp()}:${w.port}`;
}
function machine(ctx: ModCtx, name: string): Machine { const m = findMachine(ctx.home, name); if (!m) throw new Error(`machine inconnue : ${name} (ajoute-la dans Réglages → Machines)`); return m; }
/** Le système d'un poste (donné, retenu, ou demandé au poste) et le chemin pour le joindre. */
async function systemeDe(ctx: ModCtx, m: Machine, i: Record<string, unknown>): Promise<{ systeme: SystemePoste; lien: Lien }> {
  const memo = (ctx.settings.systemes as Record<string, { systeme: SystemePoste; lien: Lien }> | undefined) ?? {};
  const lien: Lien = s(i.acces) === 'winrm' ? 'winrm' : s(i.acces) === 'ssh' ? 'ssh' : memo[m.id]?.lien ?? 'ssh', v = s(i.systeme).toLowerCase();
  let systeme: SystemePoste | undefined = lien === 'winrm' || v === 'windows' ? 'windows' : /linux|mac/.test(v) ? 'posix' : memo[m.id]?.systeme;
  const os = s((ctx.settings.inventory as Record<string, { os?: string }> | undefined)?.[m.id]?.os);
  if (!systeme && os) systeme = /windows/i.test(os) ? 'windows' : 'posix';
  systeme ??= await detecterSysteme(ctx.home, m);
  if (memo[m.id]?.systeme !== systeme || memo[m.id]?.lien !== lien) ctx.saveSettings({ systemes: { ...memo, [m.id]: { systeme, lien } } });
  return { systeme, lien };
}
/** Lance le bon script sur le poste (sh ou PowerShell). */
async function surPoste(ctx: ModCtx, m: Machine, q: { posix: () => string; windows: () => string }, i: Record<string, unknown>, timeoutMs = 600_000): Promise<{ code: number | null; out: string; systeme: SystemePoste }> {
  const { systeme, lien } = await systemeDe(ctx, m, i);
  if (systeme === 'windows') return { ...(await executerPs(ctx.home, ctx.run, m, q.windows(), { lien, timeoutMs })), systeme };
  const r = essais.commande ? await essais.commande(m, q.posix()) : await runOnMachine(ctx.home, m, q.posix(), { timeoutMs }).catch((e: Error) => ({ code: 1, out: e.message }));
  return { ...r, systeme };
}
const resume = (e: Record<string, unknown> | undefined) => {
  if (!e) return 'réponse illisible'; if (e.ok === false) return s(e.erreur) || 'erreur';
  const sy = (e.systeme ?? {}) as Record<string, unknown>;
  return `${s(sy.systeme)} ${s(sy.version)} (${s(sy.build)}) · mode ${s(e.mode) || '?'} · mises à jour par ${(e.gestionnaires as string[] | undefined)?.join(', ') || 'rien'} · démarrage ${s(e.demarrage) || s(e.service) || '?'}`;
};
const posteDe = (ctx: ModCtx, x: unknown) => { const p = propre(s(x)), m = findMachine(ctx.home, s(x)); const nom = inscrits(ctx.home).find((y) => y.poste === p || y.poste === propre(m?.label ?? ''))?.poste; if (!nom) throw new Error(`pas de compagnon sur « ${s(x)} » (installe-le d'abord)`); return nom; };

const P_MACHINE: Param = { key: 'machine', label: 'Machine', kind: 'text', required: true };
const P_POSTE: Param = { key: 'poste', label: 'Poste', kind: 'text', required: true };
export const compagnonActions: Action[] = [
  { id: 'compagnon_installer', label: 'Installer le compagnon d\'Odin', what: 'Sur un poste du parc (Windows, Linux, Mac) : icône d\'Odin et bulles, antivirus d\'Asclépios, mises à jour du système, contrôle des failles', words: ['installe le compagnon', 'installe odin sur', 'compagnon sur'],
    params: [P_MACHINE, { key: 'adresse_odin', label: 'Adresse d\'Odin vue depuis ce poste', kind: 'text', default: '', help: 'Ex. https://192.168.1.10:8888 (retenue pour les postes suivants).' }, { key: 'systeme', label: 'Système', kind: 'select', options: ['deviner', 'windows', 'linux', 'mac'], default: 'deviner' }, { key: 'acces', label: 'Accès (Windows)', kind: 'select', options: ['ssh', 'winrm'], default: 'ssh' }],
    grave: (i) => `installer le compagnon d'Odin sur ${s(i.machine)} (service du système, mises à jour automatiques)`, run: async (ctx, i): Promise<ActionResult> => {
      const m = machine(ctx, s(i.machine)), odin = adressePourPostes(ctx, s(i.adresse_odin));
      if (!/^https?:\/\/[^\s'"]+$/.test(odin)) throw new Error('donne l\'adresse d\'Odin vue depuis ce poste (ex. https://192.168.1.10:8888)');
      const { systeme } = await systemeDe(ctx, m, i);
      const jeton = inscrire(ctx.home, m.label, { systeme, via: 'satellites', machine: m.id }, ctx.now()), c = { odin, jeton, poste: m.label, empreinte: /^https:/.test(odin) ? empreinteOdin(ctx.home) : '' };
      const r = await surPoste(ctx, m, { posix: () => scriptInstallationPosix(c), windows: () => scriptInstallationWindows(c) }, i, 900_000);
      const e = lireEtat(r.out);
      if (r.code !== 0 || !e || e.ok === false) { desinscrire(ctx.home, m.label); throw new Error(`compagnon non installé sur ${m.label} : ${resume(e)}`); }
      ctx.saveSettings({ odinUrl: odin });
      modifierFiche(ctx.home, m.label, (f) => { f.consignes.rapport = true; bulle(f, { niveau: 'info', titre: 'Odin est là', texte: 'Je veille sur cet ordinateur : antivirus, mises à jour et failles. Clique sur mon icône près de l\'horloge pour m\'ouvrir.' }); });
      ctx.emit('compagnon_installe', { poste: m.label, systeme });
      return { text: `🛰 Compagnon d'Odin installé sur ${m.label} : ${resume(e)}.${e.mode === 'utilisateur' ? '\n⚠ Sans droits administrateur sur ce poste : les mises à jour seront signalées, pas installées.' : ''}`, data: e };
    } },
  { id: 'compagnon_retirer', label: 'Retirer le compagnon', what: 'Le compagnon est retiré du poste ; son jeton ne vaut plus rien', params: [P_MACHINE], words: ['retire le compagnon', 'desinstalle le compagnon', 'désinstalle le compagnon'], grave: (i) => `retirer le compagnon d'Odin de ${s(i.machine)}`, run: async (ctx, i) => {
    const m = machine(ctx, s(i.machine)); desinscrire(ctx.home, m.label);
    const r = await surPoste(ctx, m, { posix: scriptRetraitPosix, windows: scriptRetraitWindows }, i, 120_000).catch((e: Error) => ({ code: 1, out: JSON.stringify({ ok: false, erreur: e.message }) }));
    const e = lireEtat(r.out);
    return { text: r.code === 0 && e?.ok !== false ? `Compagnon retiré de ${m.label}.` : `Jeton de ${m.label} révoqué ; le poste n'a pas tout retiré (${s(e?.erreur) || (e?.reste as string[] | undefined)?.join(', ') || 'pas de réponse'}).` };
  } },
  { id: 'compagnon_etat', label: 'État du compagnon', what: 'Demande son état au compagnon d\'un poste', read: true, params: [P_MACHINE], run: async (ctx, i) => {
    const m = machine(ctx, s(i.machine)), r = await surPoste(ctx, m, { posix: scriptEtatPosix, windows: scriptEtatWindows }, i, 60_000), e = lireEtat(r.out);
    return { text: `${m.label} : ${resume(e)}`, data: e };
  } },
  { id: 'compagnons', label: 'Postes avec le compagnon', what: 'Chaque poste : système exact, dernier contact, mises à jour, failles, dernière analyse', read: true, words: ['etat des postes', 'état des postes', 'compagnons', 'parc a jour', 'parc à jour'], run: (ctx) => {
    const l = parc(ctx);
    return { text: l.map((x) => `- ${x.poste} · ${x.systeme} · vu ${quand(x.vu)} · ${x.majs} mise(s) à jour · ${x.failles} faille(s)${x.ouvertes ? ` dont ${x.ouvertes} avec correctif en attente` : ''} · analyse ${quand(x.analyse)}${x.detections ? ` · ⚠ ${x.detections} fichier(s) dangereux` : ''}`).join('\n') || 'Aucun poste n\'a le compagnon : « installe le compagnon sur <poste> ».', data: { postes: l } };
  } },
  { id: 'compagnon_resultats', label: 'Résultats d\'un poste', what: 'Ce que le compagnon a vu : système, mises à jour, failles, fichiers dangereux', read: true, params: [P_POSTE], run: (ctx, i) => {
    const f = fiche(ctx.home, posteDe(ctx, i.poste)), sy = f.rapport?.systeme ?? {};
    return { text: [`${f.poste} · ${s(sy.systeme)} ${s(sy.version)} (${s(sy.build)}) · vu ${quand(f.vu)}`, `Mises à jour en attente : ${(f.rapport?.majs ?? []).slice(0, 15).map((m) => `${m.nom}${m.nouvelle ? ` → ${m.nouvelle}` : ''}`).join(', ') || 'aucune'}`, `Failles exploitées connues : ${(f.failles ?? []).slice(0, 10).map((x) => `${x.cve} (${x.logiciel}${x.majDispo ? `, correctif ${x.majDispo}` : ''})`).join(', ') || 'aucune'}`, `Dernière analyse : ${quand(f.analyse?.t)} · ${f.analyse?.fichiers ?? 0} fichier(s) · ${f.analyse?.detections.length ?? 0} dangereux`, ...(f.detections ?? []).slice(-5).map((d) => `- ${d.ecarte ? 'mis à l\'écart' : 'en place'} : ${d.fichier} (${d.quoi})`)].join('\n'), data: f };
  } },
  { id: 'compagnon_analyser', label: 'Analyser un poste', what: 'Le compagnon lance une analyse antivirus (dans la minute)', params: [P_POSTE], words: ['analyse le poste', 'analyse le pc'], run: (ctx, i) => { const p = posteDe(ctx, i.poste); modifierFiche(ctx.home, p, (f) => { f.consignes.analyser = true; }); return { text: `🔍 Analyse demandée à ${p} : les résultats arrivent ici (et dans Asclépios s'il trouve quelque chose).` }; } },
  { id: 'compagnon_majs', label: 'Mettre à jour un poste maintenant', what: 'Le compagnon installe les mises à jour du système, sans changer de version', params: [P_POSTE], grave: (i) => `installer maintenant les mises à jour sur ${s(i.poste)}`, run: (ctx, i) => { const p = posteDe(ctx, i.poste); modifierFiche(ctx.home, p, (f) => { f.consignes.appliquer_majs = true; bulle(f, { niveau: 'info', titre: 'Mises à jour', texte: 'J\'installe les mises à jour maintenant. L\'ordinateur reste utilisable ; je te dirai s\'il faut redémarrer.' }); }); return { text: `⬆ ${p} installe ses mises à jour (dans la minute).` }; } },
  { id: 'compagnon_guider', label: 'Dire quelque chose sur un poste', what: 'Une bulle d\'Odin sur l\'écran de la personne (un conseil, une étape à suivre)', params: [{ key: 'poste', label: 'Poste (ou « tous »)', kind: 'text', required: true }, { key: 'texte', label: 'Message', kind: 'textarea', required: true }], words: ['dis sur le poste', 'message sur le poste'], run: (ctx, i) => {
    const t = s(i.texte).slice(0, 300); if (!t) throw new Error('le message ?');
    const ps = s(i.poste).toLowerCase() === 'tous' ? inscrits(ctx.home).map((x) => x.poste) : [posteDe(ctx, i.poste)];
    for (const p of ps) modifierFiche(ctx.home, p, (f) => { bulle(f, { niveau: 'info', titre: 'Odin', texte: t }); });
    return { text: `💬 Message envoyé à ${ps.join(', ') || 'aucun poste'} (affiché dans la minute).` };
  } },
  { id: 'compagnon_reglages', label: 'Réglages du compagnon', what: 'Mises à jour automatiques (heure), mise à l\'écart des fichiers sûrs, fréquence des analyses', quick: false, params: [{ key: 'majs', label: 'Mises à jour du système', kind: 'select', options: ['auto', 'demander', 'non'], default: 'auto' }, { key: 'heure', label: 'Heure des mises à jour (0-23)', kind: 'number', default: 3 }, { key: 'quarantaine', label: 'Mettre à l\'écart ce qui est reconnu à coup sûr', kind: 'boolean', default: true }, { key: 'analyse_heures', label: 'Analyse toutes les (heures)', kind: 'number', default: 24 }], run: (ctx, i) => {
    const h = Number(i.heure), a = Number(i.analyse_heures); if (!(Number.isInteger(h) && h >= 0 && h <= 23)) throw new Error('heure entre 0 et 23'); if (!(a >= 1 && a <= 24 * 30)) throw new Error('analyse : entre 1 heure et 30 jours');
    ctx.saveSettings({ compagnon: { majs: ['auto', 'demander', 'non'].includes(s(i.majs)) ? s(i.majs) : 'auto', heure: h, quarantaine: i.quarantaine !== false, analyseHeures: a } });
    return { text: `⚙ Compagnon : mises à jour ${s(i.majs) === 'auto' ? `automatiques à ${h} h` : s(i.majs) === 'demander' ? 'sur demande' : 'coupées'} · mise à l'écart ${i.quarantaine !== false ? 'active' : 'coupée'} · analyse toutes les ${a} h.` };
  } },
  { id: 'compagnon_script', label: 'Script du compagnon (Genèse)', what: 'Le script qui installe le compagnon sur un poste qu\'on vient d\'installer (nouveau jeton)', quick: false, read: false, params: [P_POSTE, { key: 'systeme', label: 'Système', kind: 'select', options: ['linux', 'windows'], default: 'linux' }, { key: 'adresse_odin', label: 'Adresse d\'Odin', kind: 'text', default: '' }], run: (ctx, i) => {
    const odin = adressePourPostes(ctx, s(i.adresse_odin)), win = s(i.systeme) === 'windows', poste = propre(s(i.poste)) || 'poste';
    const jeton = inscrire(ctx.home, poste, { systeme: win ? 'windows' : 'posix', via: 'genese' }, ctx.now()), c = { odin, jeton, poste, empreinte: /^https:/.test(odin) ? empreinteOdin(ctx.home) : '' };
    modifierFiche(ctx.home, poste, (f) => { f.consignes.rapport = true; bulle(f, { niveau: 'info', titre: 'Odin est là', texte: 'Ton ordinateur vient d\'être installé : je veille dessus (antivirus, mises à jour, failles).' }); });
    return { text: `Script du compagnon pour ${poste} (${win ? 'Windows' : 'Linux'}).`, data: { script: win ? scriptInstallationWindows(c) : scriptInstallationPosix(c) } };
  } },
];

/** L'état du parc, poste par poste (sans aucun jeton). */
export function parc(ctx: ModCtx): Array<{ poste: string; systeme: string; vu?: number; majs: number; failles: number; ouvertes: number; analyse?: number; detections: number; via: string }> {
  return inscrits(ctx.home).map((x) => {
    const f = fiche(ctx.home, x.poste), sy = f.rapport?.systeme ?? {};
    return { poste: x.poste, systeme: f.rapport ? `${s(sy.systeme)} ${s(sy.version)}`.trim() : x.systeme === 'windows' ? 'Windows' : 'Linux / Mac', vu: f.vu, majs: f.rapport?.majs?.length ?? 0, failles: f.failles?.length ?? 0, ouvertes: (f.failles ?? []).filter((y) => y.majDispo).length, analyse: f.analyse?.t, detections: (f.detections ?? []).filter((d) => Date.now() - d.t < 30 * 86_400_000).length, via: x.via ?? 'satellites' };
  });
}
/** Les sections de la page de Satellites : le compagnon sur les postes. */
export function compagnonSections(ctx: ModCtx): Section[] {
  const l = parc(ctx), r = reglages(ctx), now = Date.now();
  return [
    { kind: 'table', title: 'Compagnon d\'Odin sur les postes', columns: ['Poste', 'Système', 'Vu', 'Mises à jour', 'Failles', 'Analyse', 'Fichiers dangereux (30 j)'], empty: 'Aucun poste n\'a le compagnon : installe-le (formulaire à droite) ou laisse Genèse le poser à l\'installation.',
      rows: l.map((x) => ({ cells: [x.poste, x.systeme, quand(x.vu), String(x.majs), x.ouvertes ? `${x.failles} (${x.ouvertes} avec correctif en attente)` : String(x.failles), quand(x.analyse), String(x.detections)], tone: x.detections || x.ouvertes ? 'mauvais' as const : !x.vu || now - x.vu > 86_400_000 ? 'attention' as const : 'bon' as const,
        actions: [{ action: 'compagnon_analyser', label: 'Analyser', input: { poste: x.poste } }, { action: 'compagnon_majs', label: 'Mettre à jour', input: { poste: x.poste } }, { action: 'compagnon_resultats', label: 'Résultats', input: { poste: x.poste } }] })) },
    { kind: 'text', title: 'Réglages du compagnon', text: `Mises à jour : ${r.majs === 'auto' ? `automatiques à ${r.heure} h, sans changer de version du système` : r.majs === 'demander' ? 'sur demande' : 'coupées'} · fichiers reconnus à coup sûr : ${r.quarantaine ? 'mis à l\'écart' : 'signalés seulement'} · analyse toutes les ${r.analyseHeures} h.` },
  ];
}
export const compagnonSide = (): Section[] => [{ kind: 'form', title: 'Installer le compagnon d\'Odin', action: 'compagnon_installer', submit: 'Installer', params: compagnonActions[0].params! }, { kind: 'form', title: 'Dire quelque chose sur un poste', action: 'compagnon_guider', submit: 'Envoyer', params: compagnonActions.find((a) => a.id === 'compagnon_guider')!.params! }];
