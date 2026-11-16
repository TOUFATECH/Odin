// Argos — la console de sécurité du parc (EDR). Argos ne remplace ni l'antivirus (Asclépios) ni l'anti-malware
// (Méduse) : il les commande et les résume, et il ajoute les postes. Son nom vient d'Argos Panoptès, le géant aux
// cent yeux de la mythologie grecque, qui voyait tout.
//
// Il montre :
//   - l'état de l'antivirus, de l'anti-malware et de chaque source ;
//   - les incidents actionnables (ceux d'Asclépios, partagés, et ceux des Satellites, par poste) ;
//   - la chronologie et la télémétrie de chaque poste (processus et filiation, connexions sortantes, persistance) ;
//   - la réponse sur un poste (tuer un processus, mettre un fichier en quarantaine, isoler le poste du réseau sauf
//     Odin), toujours avec l'accord du propriétaire et toujours annulable.
//
// Socle : Argos s'appuie sur le compagnon d'Odin, déjà déployé sur les postes (multi-OS, jeton, droits), comme
// capteur et répondeur ; osquery seulement s'il est déjà présent sur le poste. On n'installe pas Wazuh, Velociraptor
// ni OpenEDR (trop lourds pour une maison) : ils restent en « Alternative à ». La corrélation d'incidents est celle
// d'Asclépios (ullr/incidents.ts), partagée, jamais dupliquée.
//
// Une tâche Talos quotidienne (pilotée par Argos) vérifie que l'antivirus, l'anti-malware et toutes leurs sources
// sont à jour et lance les retards ; signatures toujours vérifiées et testées avant activation (comme aujourd'hui).

import { story, type Incident } from '../ullr/incidents.ts';
import { chargerIncidentsParc, réglerIncidentParc } from '../argos/incidents-parc.ts';
import { arbreDuPoste, poste as posteDe, postes as postesDe, type EvenementPoste } from '../argos/endpoints.ts';
import { construireConsigne, journalReponses, journaliserReponse, raisonGrave } from '../argos/reponse.ts';
import { consigneInverse, type ConsigneReponse, type GenreReponse } from '../compagnon/reponse.ts';
import { inscrits, modifierFiche } from '../compagnon/compagnon.ts';
import type { NoeudProcessus } from '../compagnon/telemetrie.ts';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { Action, ModCtx, Module, Section, Tone, View } from '../types.ts';
import type { RythmeAppli, TacheAppli } from '../types.ts';

const s = (v: unknown, n = 300) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const JOUR = 86_400_000;

/**
 * L'adresse IPv4 d'Odin vue du réseau local, pour qu'un poste isolé la garde joignable. On prend l'adresse réglée si
 * c'est une IP, sinon la vraie IPv4 de la machine d'Odin. Jamais un nom d'hôte : le pare-feu du poste n'accepte qu'une
 * IP, et un nom couperait le poste d'Odin aussi (isolement non annulable à distance).
 */
function ipOdin(ctx: ModCtx): string {
  const reglee = s(ctx.settings.adresseOdin).trim(); if (isIP(reglee)) return reglee;
  return Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '';
}

/** Réglages de la tâche quotidienne de mises à jour d'Argos. */
function reglagesMaj(ctx: ModCtx): { heure: number; mode: 'auto' | 'prevenir' } {
  const x = (ctx.settings.majParc as Record<string, unknown> | undefined) ?? {};
  return { heure: Number.isInteger(x.heure) ? Number(x.heure) : 3, mode: x.mode === 'prevenir' ? 'prevenir' : 'auto' };
}
/** Le dernier passage connu de la tâche de mises à jour. */
function dernierMaj(ctx: ModCtx): { at: string; ok: boolean; texte?: string } | undefined {
  const d = ctx.settings.majDernier as { at: string; ok: boolean; texte?: string } | undefined; return d?.at ? d : undefined;
}

/** Les deux applis qu'Argos commande et leurs actions de mise à jour (toujours pilotées par Talos via Argos). */
const COMMANDÉES: Array<{ id: string; nom: string; quoi: string; action: string }> = [
  { id: 'ullr', nom: 'Asclépios', quoi: 'antivirus (fichiers)', action: 'mettre_a_jour' },
  { id: 'geri', nom: 'Méduse', quoi: 'anti-malware (connexions, DNS, comportement)', action: 'listes' },
];

/**
 * Lance la vérification et la mise à jour de l'antivirus, de l'anti-malware et de leurs sources (une appli à la fois),
 * en appelant leurs propres actions de mise à jour (le lot antivirus/anti-malware). En mode « prévenir seulement »,
 * on vérifie l'âge mais on ne lance pas ; sinon on lance les retards. Rend un bilan par appli.
 */
export async function majSources(ctx: ModCtx, o: { forcer?: boolean } = {}): Promise<{ text: string; data: unknown }> {
  const r = reglagesMaj(ctx), bilan: Array<{ nom: string; ok: boolean; texte: string }> = [];
  for (const c of COMMANDÉES) {
    if (r.mode === 'prevenir' && !o.forcer) { bilan.push({ nom: c.nom, ok: true, texte: 'vérifié (mode prévenir seulement : pas de mise à jour automatique)' }); continue; }
    try { const res = await ctx.call(c.id, c.action, {}, 'mise à jour quotidienne pilotée par Argos', { interne: true }); bilan.push({ nom: c.nom, ok: res.ok !== false, texte: s(res.text, 200) }); }
    catch (e) { bilan.push({ nom: c.nom, ok: false, texte: `injoignable : ${s((e as Error).message, 120)}` }); }
  }
  const ok = bilan.every((b) => b.ok);
  ctx.saveSettings({ majDernier: { at: ctx.now().toISOString(), ok, texte: bilan.map((b) => `${b.nom} : ${b.texte}`).join(' · ') } });
  if (!ok) ctx.alert({ level: 'moyenne', title: 'Mise à jour de sécurité incomplète', detail: bilan.filter((b) => !b.ok).map((b) => `${b.nom} : ${b.texte}`).join('\n'), key: 'argos-maj' });
  return { text: bilan.map((b) => `${b.ok ? '✓' : '⚠'} ${b.nom} — ${b.texte}`).join('\n'), data: bilan };
}

/** Met une consigne de réponse dans la file du compagnon du poste (il la prend à sa prochaine demande). */
function envoyerConsigne(ctx: ModCtx, poste: string, c: ConsigneReponse): boolean {
  if (!inscrits(ctx.home).some((x) => x.poste === poste)) return false;
  modifierFiche(ctx.home, poste, (f) => { const r = (f.consignes.reponses ?? []).filter((x) => x.id !== c.id); f.consignes = { ...f.consignes, reponses: [...r, c].slice(-30) }; });
  return true;
}
/** Le nom d'affichage d'une appli (pour les incidents partagés). */
const nomApp = (ctx: ModCtx) => (id: string) => ctx.modules().find((m) => m.id === id)?.name ?? id;

// ---------------------------------------------------------------- Les réponses sur un poste
const P_POSTE = { key: 'poste', label: 'Poste', kind: 'text' as const, required: true };
function reponseAction(genre: GenreReponse, id: string, label: string, what: string, extra: Action['params'] = []): Action {
  return {
    id, label, what, params: [P_POSTE, ...(extra ?? [])],
    grave: (i) => raisonGrave(genre, s(i.poste), { pid: Number(i.pid) || undefined, nom: s(i.nom) || undefined, fichier: s(i.fichier) || undefined, odin: s(i.odin) || undefined }),
    undo: (i, res, ctx) => {
      if (res.ok === false) return undefined;
      const c = (res.data as { consigne?: ConsigneReponse })?.consigne; if (!c) return undefined;
      const inv = consigneInverse(c, Math.random().toString(36).slice(2, 8), ctx.now().getTime());
      return inv ? { action: inv.genre === 'liberer' ? 'liberer_poste' : 'rendre_reseau', input: { poste: s(i.poste), ...(inv.fichier ? { fichier: inv.fichier } : {}) }, label: inv.genre === 'liberer' ? 'Remettre le fichier en place' : 'Rendre le réseau au poste' } : undefined;
    },
    run: (ctx, i) => lancerReponse(ctx, genre, s(i.poste), { pid: Number(i.pid) || undefined, nom: s(i.nom) || undefined, fichier: s(i.fichier) || undefined, odin: s(i.odin) || undefined }),
  };
}
function lancerReponse(ctx: ModCtx, genre: GenreReponse, poste: string, o: { pid?: number; nom?: string; fichier?: string; odin?: string }) {
  if (!poste) return { ok: false, text: 'Dis sur quel poste.' };
  // Isoler : l'adresse d'Odin gardée joignable doit être une IP (jamais un nom). On prend celle donnée si c'est une IP,
  // sinon la vraie IPv4 d'Odin. Sans IP connue, on refuse plutôt que de couper le poste d'Odin aussi (non annulable).
  let odin = o.odin;
  if (genre === 'isoler') {
    odin = odin && isIP(odin) ? odin : ipOdin(ctx);
    if (!isIP(odin)) return { ok: false, text: 'Je ne connais pas l\'adresse IP d\'Odin vue de ce poste. Règle-la (Réglages → Accès) avant d\'isoler : sans elle, le poste serait coupé d\'Odin aussi et l\'isolement ne pourrait plus être annulé à distance.' };
  }
  const c = construireConsigne(genre, { ...o, odin }, ctx.now().getTime());
  const { ligne, inverse } = journaliserReponse(ctx.home, poste, c, 'toi', ctx.now().getTime());
  const envoyee = envoyerConsigne(ctx, poste, c);
  modifierFiche(ctx.home, poste, (f) => { f.consignes = { ...f.consignes }; });
  const suite = envoyee ? 'Le compagnon du poste l\'applique à sa prochaine prise de contact.' : 'Aucun compagnon sur ce poste : rien n\'a été envoyé (installe-le depuis Satellites, ou agis par SSH).';
  return { ok: true, text: `${ligne.texte}. ${suite}`, data: { consigne: c, inverse } };
}

const actions: Action[] = [
  { id: 'argos', label: 'Ouvrir la console', what: 'La console de sécurité du parc', read: true, quiet: true, run: () => ({ text: 'Console Argos : état des protections, incidents, postes et réponses.' }) },
  { id: 'etat', label: 'État des protections', what: 'Antivirus, anti-malware et leurs sources', read: true, words: ['etat edr', 'etat de la securite', 'état de la sécurité', 'edr'],
    run: async (ctx) => {
      const lignes: string[] = [];
      for (const c of COMMANDÉES) { try { const r = await ctx.call(c.id, 'etat', {}, 'état pour Argos', { interne: true }); lignes.push(`${r.ok === false ? '⚠ ' : ''}${c.nom} (${c.quoi}) : ${s(r.text, 200).split('\n')[0]}`); } catch { lignes.push(`⚠ ${c.nom} (${c.quoi}) : état indisponible`); } }
      const d = dernierMaj(ctx); lignes.push(`Dernière vérification des mises à jour : ${d ? `${new Date(d.at).toLocaleString('fr-FR')} (${d.ok ? 'à jour' : 'incomplète'})` : 'jamais'}`);
      return { text: lignes.join('\n') };
    } },
  { id: 'maj_sources', label: 'Vérifier et mettre à jour', what: 'Vérifie que l\'antivirus, l\'anti-malware et leurs sources sont à jour, et lance les retards.', words: ['mets a jour la securite', 'mets à jour la sécurité', 'verifie les mises a jour'], run: (ctx) => majSources(ctx, { forcer: true }) },
  { id: 'incidents', label: 'Incidents', what: 'Les incidents du parc et d\'Asclépios', read: true, words: ['incidents', 'incident'],
    run: (ctx) => { const parc = chargerIncidentsParc(ctx.home).filter((i) => i.state === 'ouvert'); return { text: parc.length ? parc.map((i) => `• [${i.level}] ${i.title} (${i.apps.join(', ')})`).join('\n') : 'Aucun incident ouvert sur les postes du parc.', data: parc }; } },
  { id: 'incident', label: 'Voir un incident', what: 'La chronologie et l\'arbre des processus d\'un incident', read: true, external: true, params: [{ key: 'id', label: 'Incident', kind: 'text', required: true }],
    run: (ctx, i) => {
      const inc = chargerIncidentsParc(ctx.home).find((x) => x.id === s(i.id)); if (!inc) return { text: 'Incident introuvable.' };
      // L'incident porte son poste dans ses signaux : on y relie l'arbre des processus de ce poste (qui a lancé quoi).
      const poste = inc.signals.find((x) => x.poste)?.poste ?? '';
      const arbre = poste ? arbreDuPosteLignes(ctx.home, poste) : [];
      const texte = arbre.length ? `${story(inc)}\n\nArbre des processus de ${poste} :\n${arbre.join('\n')}` : story(inc);
      return { text: texte, data: { incident: inc, poste, arbre } };
    } },
  { id: 'traiter_incident', label: 'Marquer traité', what: 'Marque un incident du parc comme traité', params: [{ key: 'id', label: 'Incident', kind: 'text', required: true }], run: (ctx, i) => { const x = réglerIncidentParc(ctx.home, s(i.id), 'traité'); return { text: x ? `Incident « ${x.title} » marqué traité.` : 'Incident introuvable.' }; } },
  { id: 'ignorer_incident', label: 'Ignorer', what: 'Marque un incident du parc comme ignoré', params: [{ key: 'id', label: 'Incident', kind: 'text', required: true }], run: (ctx, i) => { const x = réglerIncidentParc(ctx.home, s(i.id), 'ignoré'); return { text: x ? `Incident « ${x.title} » ignoré.` : 'Incident introuvable.' }; } },
  { id: 'postes', label: 'Postes', what: 'Les postes du parc et leur dernière télémétrie', read: true, words: ['postes', 'parc', 'telemetrie', 'télémétrie'],
    run: (ctx) => { const l = postesDe(ctx.home); return { text: l.length ? l.map((p) => `• ${p.poste}${p.sys ? ` (${p.sys})` : ''} — ${p.telemetrie?.processus.length ?? 0} programmes, ${p.telemetrie?.connexions.length ?? 0} connexions sortantes · vu ${p.vu ? new Date(p.vu).toLocaleString('fr-FR') : 'jamais'}`).join('\n') : 'Aucun poste n\'a encore envoyé de télémétrie (le compagnon la collecte dès qu\'il est à jour).', data: l }; } },
  { id: 'chronologie', label: 'Chronologie d\'un poste', what: 'Ce qui a été lancé et vu sur un poste, dans l\'ordre', read: true, external: true, params: [P_POSTE],
    run: (ctx, i) => { const p = posteDe(ctx.home, s(i.poste)); const c = p.chronologie.slice(-40).reverse(); return { text: c.length ? c.map((e) => `${new Date(e.t).toLocaleString('fr-FR')} · ${e.texte}`).join('\n') : 'Rien pour ce poste.', data: c }; } },
  { id: 'analyser_poste', label: 'Analyser un poste', what: 'Lance une analyse antivirus d\'un poste du parc (par Asclépios, via le compagnon ou à distance).', params: [P_POSTE, { key: 'dossier', label: 'Dossier (vide : les dossiers à risque)', kind: 'text', default: '' }],
    grave: () => undefined, run: async (ctx, i) => {
      const poste = s(i.poste), dossier = s(i.dossier);
      try {
        // Un poste à compagnon : il analyse en local (résultats dans Asclépios), sans identifiants ni partage à distance.
        if (inscrits(ctx.home).some((x) => x.poste === poste)) return await ctx.call('hermod', 'compagnon_analyser', { poste }, 'analyse d\'un poste pilotée par Argos', { interne: true });
        // Sinon, à distance par Asclépios (SMB/SSH) : le dossier demandé devient l'endroit à analyser (sinon les dossiers à risque).
        return await ctx.call('ullr', 'analyser_poste', { poste, ou: dossier, quoi: dossier ? 'tout' : 'rapide' }, 'analyse d\'un poste pilotée par Argos', { interne: true });
      } catch (e) { return { ok: false, text: `Analyse impossible : ${s((e as Error).message, 160)}` }; }
    } },
  reponseAction('tuer', 'tuer', 'Tuer un processus', 'Arrête un processus sur un poste (par son compagnon).', [{ key: 'pid', label: 'Numéro du processus (pid)', kind: 'number', required: true }, { key: 'nom', label: 'Nom (pour le journal)', kind: 'text', default: '' }]),
  reponseAction('quarantaine', 'quarantaine_poste', 'Mettre un fichier en quarantaine', 'Met un fichier à l\'écart sur un poste (réversible).', [{ key: 'fichier', label: 'Chemin du fichier', kind: 'text', required: true }]),
  reponseAction('liberer', 'liberer_poste', 'Remettre un fichier en place', 'Sort un fichier de la quarantaine d\'un poste.', [{ key: 'fichier', label: 'Chemin du fichier', kind: 'text', required: true }]),
  reponseAction('isoler', 'isoler_poste', 'Isoler un poste', 'Coupe un poste du réseau, sauf Odin (réversible).', [{ key: 'odin', label: 'Adresse d\'Odin vue du poste', kind: 'text', default: '' }]),
  reponseAction('rendre_reseau', 'rendre_reseau', 'Rendre le réseau', 'Rend le réseau à un poste isolé.'),
  { id: 'journal_reponses', label: 'Journal des réponses', what: 'Les réponses lancées sur les postes', read: true, words: ['journal des reponses', 'reponses'],
    run: (ctx) => { const l = journalReponses(ctx.home).slice(0, 60); return { text: l.length ? l.map((x) => `${x.at.slice(0, 16).replace('T', ' ')} · ${x.poste} · ${x.texte} (${x.etat})`).join('\n') : 'Aucune réponse lancée.', data: l }; } },
];

function arbreLignes(noeuds: NoeudProcessus[], prof = 0, out: string[] = []): string[] {
  for (const n of noeuds.slice(0, 60)) { out.push(`${'  '.repeat(prof)}• ${n.proc.nom} (${n.proc.pid})`); if (out.length < 80) arbreLignes(n.enfants, prof + 1, out); }
  return out;
}

export const argos: Module = {
  id: 'argos', name: 'Argos', family: 'Sécurité',
  what: 'La console de sécurité du parc (EDR) : commande et résume l\'antivirus et l\'anti-malware, suit chaque poste (processus, connexions, persistance), relie les incidents et répond (tuer, quarantaine, isoler), toujours avec ton accord.',
  does: [
    'commande et résume l\'antivirus (Asclépios) et l\'anti-malware (Méduse), et l\'état de chaque source',
    'incidents actionnables : ceux d\'Asclépios (partagés, même moteur) et ceux des Satellites, par poste, avec chronologie et arbre des processus',
    'télémétrie des postes par le compagnon d\'Odin (processus et filiation, connexions sortantes, persistance), osquery seulement s\'il est présent',
    'réponse sur un poste : tuer un processus, mettre un fichier en quarantaine, isoler le poste du réseau sauf Odin — grave, annulable, journalisé',
    'tâche quotidienne qui vérifie et met à jour l\'antivirus, l\'anti-malware et leurs sources (heure creuse réglable, mode « prévenir seulement »)',
    'ne s\'appuie pas sur un gros socle (Wazuh, Velociraptor, OpenEDR) : trop lourd pour une maison, gardé en « Alternative à » ; il enrichit le compagnon déjà déployé',
  ],
  from: ['Wazuh', 'Velociraptor', 'OpenEDR', 'osquery'], upstream: ['wazuh/wazuh', 'Velocidex/velociraptor', 'ComodoSecurity/openedr', 'osquery/osquery'],
  words: ['edr', 'console de securite', 'console de sécurité', 'parc', 'postes', 'telemetrie', 'télémétrie', 'reponse', 'réponse', 'isoler', 'isolement', 'chronologie', 'incidents parc', 'malware', 'logiciel malveillant', 'argos'],
  actions,
  taches(ctx): TacheAppli[] {
    return [{
      id: 'maj_quotidienne', nom: 'Mises à jour de sécurité', quoi: 'Vérifie chaque jour que l\'antivirus, l\'anti-malware et toutes leurs sources sont à jour, et lance les retards.', securite: true,
      rythme: (cx) => ({ genre: 'jour', heure: `${String(reglagesMaj(cx).heure).padStart(2, '0')}:00` } as RythmeAppli),
      permis: ['jour'], regler: (cx, r) => { if (r.genre !== 'jour') throw new Error('cette tâche tourne une fois par jour (choisis l\'heure)'); cx.saveSettings({ majParc: { ...reglagesMaj(cx), heure: Number(r.heure.slice(0, 2)) } }); },
      lancer: { action: 'maj_sources' },
      dernier: (cx) => dernierMaj(cx),
    }];
  },
  watch: { every: 3600, run(ctx) {
    // Veille légère : si la vérification quotidienne des mises à jour a pris du retard (plus d'un jour), on prévient.
    const d = dernierMaj(ctx);
    if (d && ctx.now().getTime() - Date.parse(d.at) > 2 * JOUR) ctx.alert({ level: 'moyenne', title: 'Mises à jour de sécurité en retard', detail: `Dernière vérification : ${new Date(d.at).toLocaleString('fr-FR')}. Argos relance ce soir à ${reglagesMaj(ctx).heure} h.`, key: 'argos-retard' });
  } },
  async view(ctx): Promise<View> {
    const r = reglagesMaj(ctx), d = dernierMaj(ctx);
    const incidents = chargerIncidentsParc(ctx.home).filter((i) => i.state === 'ouvert').slice(0, 20);
    const lesPostes = postesDe(ctx.home);
    const reponses = journalReponses(ctx.home).slice(0, 30);
    // État des deux protections commandées (résilient : chaque appel peut échouer sans casser la page).
    const etats: Array<{ nom: string; quoi: string; texte: string; tone: Tone }> = [];
    for (const c of COMMANDÉES) {
      // Un état en échec (action inconnue, source en retard) rend { ok:false } sans lever : on colore sur r.ok, pas seulement sur une exception, sinon le voyant resterait vert même en panne.
      try { const e = await ctx.call(c.id, 'etat', {}, 'console Argos', { interne: true }); etats.push({ nom: c.nom, quoi: c.quoi, texte: s(e.text, 160).split('\n')[0] || 'en service', tone: e.ok === false ? 'attention' : 'bon' }); }
      catch { etats.push({ nom: c.nom, quoi: c.quoi, texte: 'état indisponible', tone: 'attention' }); }
    }
    const niveau = (l: Incident['level']): Tone => (l === 'critique' ? 'mauvais' : l === 'haute' ? 'attention' : 'neutre');
    const sections: Section[] = [
      { kind: 'cards', title: 'Protections commandées par Argos', items: etats.map((e) => ({ title: e.nom, sub: e.quoi, meta: e.texte, tone: e.tone, badge: e.tone === 'bon' ? 'en service' : 'à regarder' })) },
      { kind: 'table', title: 'Incidents ouverts (postes du parc)', columns: ['Niveau', 'Incident', 'Applis', 'Mis à jour'], empty: 'Aucun incident ouvert sur les postes du parc. (Les incidents de la machine d\'Odin sont dans Asclépios.)',
        rows: incidents.map((i) => ({ cells: [i.level, i.title, i.apps.join(', '), new Date(i.updated).toLocaleString('fr-FR')], tone: niveau(i.level), actions: [{ action: 'incident', label: 'Voir', input: { id: i.id } }, { action: 'traiter_incident', label: 'Traité', input: { id: i.id } }] })) },
      { kind: 'table', title: 'Postes du parc', onglet: 'Postes', large: true, columns: ['Poste', 'Système', 'Programmes', 'Connexions', 'Vu'], empty: 'Aucune télémétrie reçue. Le compagnon la collecte dès qu\'il est à jour (Satellites).',
        rows: lesPostes.map((p) => ({ cells: [p.poste, p.sys ?? '?', String(p.telemetrie?.processus.length ?? 0), String(p.telemetrie?.connexions.length ?? 0), p.vu ? new Date(p.vu).toLocaleString('fr-FR') : 'jamais'], actions: [{ action: 'chronologie', label: 'Chronologie', input: { poste: p.poste } }, { action: 'analyser_poste', label: 'Analyser', input: { poste: p.poste } }] })) },
      { kind: 'table', title: 'Réponses lancées', onglet: 'Réponses', large: true, columns: ['Quand', 'Poste', 'Réponse', 'État'], empty: 'Aucune réponse lancée. Une réponse (tuer, quarantaine, isoler) demande ton accord et reste annulable.',
        rows: reponses.map((x) => ({ cells: [x.at.slice(0, 16).replace('T', ' '), x.poste, x.texte, x.etat] })) },
    ];
    return {
      subtitle: `Mises à jour : ${r.mode === 'auto' ? `automatiques à ${r.heure} h` : 'prévenir seulement'} · dernière vérification ${d ? new Date(d.at).toLocaleString('fr-FR') : 'jamais'}`,
      onglets: ['Console', 'Postes', 'Réponses'],
      kpis: [
        { label: 'Postes suivis', value: String(lesPostes.length) },
        { label: 'Incidents ouverts', value: String(incidents.length), tone: incidents.length ? 'attention' : 'bon' },
        { label: 'Protections', value: `${etats.filter((e) => e.tone === 'bon').length}/${etats.length}`, tone: etats.every((e) => e.tone === 'bon') ? 'bon' : 'attention' },
      ],
      sections,
      side: [{ kind: 'actions', title: 'Mises à jour', boutons: [{ action: 'maj_sources', label: 'Vérifier et mettre à jour', primary: true }], aide: 'Tâche quotidienne pilotée par Argos (Talos). Réglable : heure creuse, ou « prévenir seulement ».' }],
    };
  },
};

/** L'arbre des processus d'un poste, en lignes (pour la fiche d'un incident et les essais). */
export function arbreDuPosteLignes(home: string, poste: string): string[] { return arbreLignes(arbreDuPoste(posteDe(home, poste))); }
/** Le dernier événement de la chronologie d'un poste (pour les essais). */
export function dernierEvenement(home: string, poste: string): EvenementPoste | undefined { return posteDe(home, poste).chronologie.at(-1); }
