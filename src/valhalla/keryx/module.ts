// Kéryx dans la grille des applis d'Odin. Sa page dessinée à la main (src/web/pages/keryx.js, OdinPages.keryx) reste
// sa page à l'écran ; ce module lui donne en plus de VRAIES actions (pour Odin, Talos et le mode sans IA) et une vue
// générique (rendu commun), branchées sur les MÊMES fonctions que les routes /api/keryx/* (src/web/keryx-api.ts) :
// reglages.ts (liste blanche, ligne, autonomie, surveillances), auth.ts (code secret), trace.ts (historique), faux.ts
// (essai contre un faux pair). Aucune logique en double.
//
// Droits : tout ce qui AFFAIBLIT une protection ou EFFACE des données est « grave » (accord du propriétaire, refusé à
// une automatisation) : ajouter un numéro à la liste blanche, poser ou changer le code secret, allumer une ligne,
// monter l'autonomie, autoriser une action grave par appel, effacer l'historique. Ce qui RENFORCE (retirer un numéro,
// éteindre la ligne, baisser l'autonomie, retirer le code) se fait d'un clic.
//
// Kéryx AGIT surtout en pilotant les applis d'Odin depuis les messages qu'il reçoit de dehors (canal.ts / actions.ts).

import type { Action, Kpi, ModCtx, Module, Section } from '../types.ts';
import { effacerSecret, normaliser, poserSecret, secretPose } from './auth.ts';
import { ecrireReglages, lireReglages } from './reglages.ts';
import { configurerTrace, effacer, lire } from './trace.ts';
import { fauxModem, fauxSip } from './faux.ts';
import { NON_ESSAYE, type Ligne, type NiveauAuto, type Surveillance } from './types.ts';

const s = (v: unknown) => String(v ?? '').trim();
const LIGNES: Ligne[] = ['aucune', 'modem', 'sip'];
const NIVEAUX: NiveauAuto[] = ['prudent', 'equilibre', 'autonome'];
const RANG: Record<NiveauAuto, number> = { prudent: 0, equilibre: 1, autonome: 2 };
const NOM_LIGNE: Record<Ligne, string> = { aucune: 'aucune ligne', modem: 'modem GSM', sip: 'ligne SIP' };
/** Un numéro montré masqué (les 2 derniers chiffres seulement) : la liste blanche est privée. */
const masque = (n: string): string => (n.length > 2 ? `${'•'.repeat(Math.min(8, n.length - 2))}${n.slice(-2)}` : '••');
/** Un texte long raccourci par le milieu (lisible à 390 px). */
const court = (t: string, max = 60): string => (t.length > max ? `${t.slice(0, max - 18)}…${t.slice(-15)}` : t);
/** Une date ISO en heure locale. */
const local = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const vrai = (v: unknown): boolean => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';

/** La chronologie de Kéryx se range sous le dossier d'Odin (même réglage que les routes). */
const trace = (ctx: ModCtx): boolean => { if (!ctx.home) return false; configurerTrace(ctx.home); return true; };

const etatA: Action = {
  id: 'etat', label: 'État de Kéryx', read: true,
  what: 'La ligne, le code secret posé ou non, la liste blanche (masquée), l\'autonomie après le code et ce que Kéryx surveille',
  words: ['etat de keryx', 'keryx etat'],
  run(ctx) {
    const r = lireReglages(ctx.home);
    const txt = [
      `Ligne : ${NOM_LIGNE[r.ligne]}${r.ligne === 'aucune' ? '' : ` (${NON_ESSAYE})`}.`,
      `Code secret : ${secretPose(ctx.home) ? 'posé' : 'pas encore posé (Kéryx n\'agit pas sans lui)'}.`,
      `Liste blanche : ${r.numeros.length ? r.numeros.map(masque).join(', ') : 'vide (personne ne peut joindre Kéryx)'}.`,
      `Autonomie après le code : ${r.autonomieApresSecret} ; action grave par appel : ${r.actionGraveParAppel === 'interdite' ? 'interdite' : 'confirmée sur un second canal'}.`,
      `Surveille : ${r.surveillances.filter((x) => x.actif).map((x) => (x.quoi === 'rappel_rdv' ? `rappel de rendez-vous (${x.reglage || '30'} min avant)` : 'mail important')).join(', ') || 'rien'}.`,
    ].join('\n');
    return { text: txt, data: { ligne: r.ligne, numeros: r.numeros.length, secret: secretPose(ctx.home), autonomie: r.autonomieApresSecret } };
  },
};

const historiqueA: Action = {
  id: 'historique', label: 'Historique', read: true, external: true, quiet: true,
  what: 'Les derniers échanges et actions de Kéryx (déchiffrés pour toi seulement)',
  words: ['historique de keryx', 'keryx historique'],
  params: [{ key: 'n', label: 'Combien', kind: 'number', default: 20 }],
  async run(ctx, i) {
    if (!trace(ctx)) return { text: 'Historique indisponible.', data: { entrees: [] } };
    const l = await lire({ n: Math.max(1, Math.min(200, Number(i.n) || 20)) });
    return { text: l.length ? l.map((e) => `${local(e.quand)} · ${e.sens} · ${e.canal} · ${court(e.texte, 120)}${e.resultat ? ` (${e.resultat})` : ''}`).join('\n') : 'Aucun échange pour l\'instant.', data: { entrees: l.length } };
  },
};

const ajouterNumeroA: Action = {
  id: 'ajouter_numero', label: 'Ajouter un numéro à la liste blanche',
  what: 'Autorise un numéro ou un identifiant de messagerie à joindre Kéryx (il devra encore prouver le code secret)',
  params: [{ key: 'numero', label: 'Numéro ou identifiant', kind: 'text', required: true, prive: true }],
  grave: (i) => `autoriser ${masque(normaliser(s(i.numero)) || s(i.numero))} à joindre Kéryx`,
  run(ctx, i) {
    const n = normaliser(s(i.numero)); if (!n) throw new Error('numéro vide');
    const r = lireReglages(ctx.home);
    const next = ecrireReglages(ctx.home, { numeros: [...r.numeros, n] });
    return { text: `Ajouté : ${masque(n)} (${next.numeros.length} numéro(s) en liste blanche).`, data: { numeros: next.numeros.length } };
  },
};

const retirerNumeroA: Action = {
  id: 'retirer_numero', label: 'Retirer un numéro de la liste blanche',
  what: 'Ce numéro ne peut plus joindre Kéryx',
  params: [{ key: 'numero', label: 'Numéro ou identifiant', kind: 'text', required: true, prive: true }],
  run(ctx, i) {
    const n = normaliser(s(i.numero));
    const r = lireReglages(ctx.home);
    const reste = r.numeros.filter((x) => normaliser(x) !== n);
    if (reste.length === r.numeros.length) return { text: 'Ce numéro n\'est pas dans la liste blanche.', ok: false };
    ecrireReglages(ctx.home, { numeros: reste });
    return { text: `Retiré (${reste.length} numéro(s) en liste blanche).`, data: { numeros: reste.length } };
  },
};

const codeA: Action = {
  id: 'code_secret', label: 'Poser ou changer le code secret',
  what: 'Le code que tu envoies (« code <xxx> ») pour que Kéryx agisse ; seule son empreinte est gardée',
  params: [{ key: 'code', label: 'Code secret (4 caractères au moins)', kind: 'password', required: true }],
  grave: (_i, ctx) => (ctx && secretPose(ctx.home) ? 'changer le code secret de Kéryx' : 'poser le code secret de Kéryx : avec lui, un numéro de la liste blanche peut le faire agir'),
  run(ctx, i) { poserSecret(ctx.home, String(i.code ?? '')); return { text: 'Code secret enregistré (seule son empreinte est gardée).', data: { pose: true } }; },
};

const retirerCodeA: Action = {
  id: 'retirer_code', label: 'Retirer le code secret',
  what: 'Sans code, Kéryx accueille mais n\'agit plus pour personne',
  run(ctx) { effacerSecret(ctx.home); return { text: 'Code secret retiré : Kéryx n\'agit plus tant qu\'un nouveau code n\'est pas posé.', data: { pose: false } }; },
};

const reglerA: Action = {
  id: 'regler', label: 'Régler Kéryx',
  what: 'La ligne (aucune, modem, SIP), l\'autonomie après le code, l\'action grave par appel, le rappel de rendez-vous',
  params: [
    { key: 'ligne', label: 'Ligne', kind: 'select', options: LIGNES },
    { key: 'autonomie', label: 'Autonomie après le code', kind: 'select', options: NIVEAUX },
    { key: 'graveParAppel', label: 'Action grave par appel', kind: 'select', options: ['interdite', 'second_canal'] },
    { key: 'rappelRdv', label: 'Rappel de rendez-vous', kind: 'boolean' },
    { key: 'rappelMinutes', label: 'Minutes avant le rendez-vous', kind: 'number' },
  ],
  // Grave : allumer une ligne, monter l'autonomie, autoriser une action grave par appel.
  grave: (i, ctx) => {
    const r = ctx ? lireReglages(ctx.home) : undefined; if (!r) return undefined;
    const out: string[] = [];
    const l = s(i.ligne) as Ligne;
    if (LIGNES.includes(l) && l !== 'aucune' && l !== r.ligne) out.push(`allumer ${l === 'modem' ? 'le modem GSM' : 'la ligne SIP'} : Kéryx sera joignable par ce canal`);
    const a = s(i.autonomie) as NiveauAuto;
    if (NIVEAUX.includes(a) && RANG[a] > RANG[r.autonomieApresSecret]) out.push(`monter l'autonomie de Kéryx à « ${a} »`);
    if (s(i.graveParAppel) === 'second_canal' && r.actionGraveParAppel !== 'second_canal') out.push('autoriser une action grave demandée par appel (confirmée sur un second canal)');
    return out.length ? out.join(' ; ') : undefined;
  },
  run(ctx, i) {
    const r = lireReglages(ctx.home);
    const p: Parameters<typeof ecrireReglages>[1] = {};
    const l = s(i.ligne) as Ligne; if (LIGNES.includes(l)) p.ligne = l;
    const a = s(i.autonomie) as NiveauAuto; if (NIVEAUX.includes(a)) p.autonomieApresSecret = a;
    const g = s(i.graveParAppel); if (g === 'interdite' || g === 'second_canal') p.actionGraveParAppel = g;
    if (i.rappelRdv !== undefined && i.rappelRdv !== '') {
      const autres = r.surveillances.filter((x) => x.quoi !== 'rappel_rdv');
      const avant = r.surveillances.find((x) => x.quoi === 'rappel_rdv');
      const min = Number(i.rappelMinutes);
      const rdv: Surveillance = { id: avant?.id ?? 'rappel-rdv', quoi: 'rappel_rdv', reglage: Number.isFinite(min) && min > 0 ? String(Math.min(1440, Math.round(min))) : avant?.reglage || '30', actif: vrai(i.rappelRdv) };
      p.surveillances = [...autres, rdv];
    }
    const n = ecrireReglages(ctx.home, p);
    return { text: `Réglé : ${NOM_LIGNE[n.ligne]}, autonomie ${n.autonomieApresSecret}, action grave par appel ${n.actionGraveParAppel === 'interdite' ? 'interdite' : 'sur second canal'}, rappel de rendez-vous ${n.surveillances.some((x) => x.quoi === 'rappel_rdv' && x.actif) ? 'allumé' : 'éteint'}.`, data: { ligne: n.ligne, autonomie: n.autonomieApresSecret } };
  },
};

const effacerA: Action = {
  id: 'effacer_historique', label: 'Effacer l\'historique',
  what: 'Efface toute la chronologie de Kéryx (échanges et actions) ; l\'effacement est réel',
  grave: () => 'effacer tout l\'historique de Kéryx (échanges et actions), sans retour possible',
  async run(ctx) { if (!trace(ctx)) return { text: 'Historique indisponible.', ok: false }; const n = await effacer({ tout: true }); return { text: `Historique effacé (${n} entrée(s)).`, data: { efface: n } }; },
};

const essayerA: Action = {
  id: 'essayer', label: 'Essayer contre un faux pair', read: true, quick: false,
  what: `Rejoue l'échange d'une ligne SIP ou d'un modem contre un FAUX pair (rien n'est envoyé) — ${NON_ESSAYE}`,
  params: [{ key: 'quoi', label: 'Quoi', kind: 'select', options: ['sip', 'modem'], default: 'sip' }],
  async run(_ctx, i) {
    const e = s(i.quoi) === 'modem' ? await fauxModem() : await fauxSip();
    return { text: `${e.ok ? 'Échange complet' : 'Échange incomplet'} contre un faux ${e.quoi === 'sip' ? 'serveur SIP' : 'modem'} (${e.etapes.length} trame(s)) — ${e.note}.`, data: e };
  },
};

export const keryxModule: Module = {
  id: 'keryx', name: 'Kéryx', family: 'Maison',
  what: 'L\'assistant d\'Odin qu\'on joint de dehors (messagerie, et plus tard SMS ou appel) et qui AGIT à ta place : mails, agenda, autres applis — par message ou par la voix.',
  does: [
    'joignable sans appli par les messageries déjà actives (Telegram…), par la voix, et — quand une ligne est branchée — par SMS ou par appel (codés, pas encore essayés sur du vrai matériel)',
    'agit à ta place : trie, résume et répond à tes mails, tient ton agenda, enchaîne les étapes',
    'peut t\'écrire le premier : rappel de rendez-vous (selon ce que tu l\'autorises à surveiller)',
    'deux crans avant d\'agir : numéro en liste blanche, puis code secret ; confirmation avant toute action peu réversible',
    'aucune capture d\'écran, aucun pistage de ta position ; échanges et actions privés, chiffrés au repos',
  ],
  from: [], upstream: [],
  words: ['keryx', 'kéryx', 'assistant', 'joignable', 'sms', 'appel', 'texto', 'hermes', 'messager', 'secretaire', 'secrétaire'],
  actions: [etatA, historiqueA, ajouterNumeroA, retirerNumeroA, codeA, retirerCodeA, reglerA, effacerA, essayerA],
  async view(ctx) {
    const r = lireReglages(ctx.home);
    const pose = ctx.home ? secretPose(ctx.home) : false;
    const histo = trace(ctx) ? await lire({ n: 20 }).catch(() => []) : [];
    const rdv = r.surveillances.find((x) => x.quoi === 'rappel_rdv');
    const kpis: Kpi[] = [
      { label: 'Ligne', value: NOM_LIGNE[r.ligne], tone: 'neutre', hint: r.ligne === 'aucune' ? 'joignable par les messageries d\'Odin' : NON_ESSAYE },
      { label: 'Code secret', value: pose ? 'posé' : 'pas posé', tone: pose ? 'bon' : 'attention', hint: pose ? 'seule son empreinte est gardée' : 'sans code, Kéryx n\'agit pour personne' },
      { label: 'Liste blanche', value: String(r.numeros.length), hint: 'numéros autorisés à joindre Kéryx' },
      { label: 'Autonomie', value: r.autonomieApresSecret, hint: 'après le code secret' },
    ];
    const sections: Section[] = [
      { kind: 'text', title: 'Vie privée', tone: 'neutre', text: 'Kéryx ne prend aucune capture d\'écran et ne piste pas ta position. Les échanges et les actions sont chiffrés au repos ; le code secret n\'est jamais gardé en clair.' },
      { kind: 'table', title: 'Liste blanche', columns: ['Numéro (masqué)'], rows: r.numeros.map((n) => ({ cells: [masque(n)] })), empty: 'Personne : ajoute un numéro pour pouvoir joindre Kéryx.' },
      { kind: 'form', title: 'Réglages', action: 'regler', submit: 'Enregistrer', params: [
        { key: 'ligne', label: 'Ligne', kind: 'select', options: LIGNES, default: r.ligne },
        { key: 'autonomie', label: 'Autonomie après le code', kind: 'select', options: NIVEAUX, default: r.autonomieApresSecret },
        { key: 'graveParAppel', label: 'Action grave par appel', kind: 'select', options: ['interdite', 'second_canal'], default: r.actionGraveParAppel },
        { key: 'rappelRdv', label: 'Rappel de rendez-vous', kind: 'boolean', default: rdv?.actif === true },
        { key: 'rappelMinutes', label: 'Minutes avant le rendez-vous', kind: 'number', default: Number(rdv?.reglage) || 30 },
      ], aide: 'Allumer une ligne, monter l\'autonomie ou autoriser une action grave par appel demande ton accord.' },
      { kind: 'log', title: 'Derniers échanges', lines: histo.length ? histo.map((e) => `${local(e.quand)} · ${e.sens} · ${court(e.texte, 100)}`) : ['Aucun échange pour l\'instant.'] },
      { kind: 'actions', title: 'Ménage', boutons: [{ action: 'effacer_historique', label: 'Effacer l\'historique' }] },
    ];
    return { subtitle: `L'assistant joignable de dehors · ${NOM_LIGNE[r.ligne]} · code ${pose ? 'posé' : 'pas posé'}`, kpis, sections };
  },
};
