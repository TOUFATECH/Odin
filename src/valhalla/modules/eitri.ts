// Andromède · les ISO : Windows, Linux, serveurs et outils de dépannage rangés dans un dossier (disque ou partage
// réseau), gardés à jour depuis les sites officiels, empreinte vérifiée. Une nouvelle version remplace l'ancienne,
// qui part dans un sous-dossier « old » (une seule ancienne gardée par ISO).
// Reprend les idées d'ISOMan et des gestionnaires de miroirs (Netboot, Ventoy), réécrit pour Odin.
// Son dossier est l'« espace ISO » commun avec Hydre : une seule bibliothèque, vue des deux côtés (onglet « ISO »).
import { forgeModule } from '../forge/forge.ts';
import { ISO } from '../forge/sources.ts';
import type { View } from '../types.ts';
import { quarantaineDabord } from '../ullr/garde.ts';
import { fichiersDeDemarrage } from '../ymir/isos.ts';

export const eitri = forgeModule({
  id: 'eitri', name: 'Andromède', kind: 'iso', noun: 'ISO', nouns: 'ISO', defaultDir: 'ISO',
  what: 'Les ISO (Windows, Linux, serveurs, dépannage) rangées dans un dossier ou un partage réseau, gardées à jour depuis les sites officiels aux jours que tu programmes ; l\'ancienne version part dans « old ».',
  from: ['ISOMan', 'netboot.xyz', 'Ventoy'], upstream: ['netbootxyz/netboot.xyz', 'ventoy/Ventoy'],
  words: ['iso', 'isos', 'image iso', 'images iso', 'image disque', 'isoman', 'distribution linux', 'ubuntu', 'debian', 'fedora', 'proxmox'],
  sources: ISO,
  extraDoes: ['Windows : Microsoft ne permet pas le téléchargement automatique, Odin repère tes ISO et donne la page officielle', 'clé USB de démarrage avec Rufus ou Ventoy, gardés à jour par Hermès', 'chaque ISO téléchargée passe par l\'antivirus (quarantaine d\'abord) puis rejoint la bibliothèque d\'Hydre (même espace ISO)', 'nouvelle version : l\'ancienne va dans « old » (une seule gardée), les machines d\'Hydre suivent', 'vérification de toutes les ISO, mensuelle par défaut (empreinte, antivirus, nouvelles versions)'],
  // Quarantaine d'abord : l'ISO téléchargée est analysée (empreinte complète, début du fichier, fichiers de démarrage)
  // avant de remplacer l'ancienne ; puis sa fiche est faite dans la bibliothèque commune avec Hydre.
  after: async (ctx, path, _src, rel) => {
    const p = await quarantaineDabord({ fichier: path, origine: 'Andromède · ISO téléchargée', source: rel?.url, usage: 'créer une machine virtuelle ou installer un PC', interieur: () => fichiersDeDemarrage(path) }, ctx);
    if (p.bloque) return p.menace ?? 'menace';
    await ctx.call('ymir', 'ajouter_iso', { chemin: path, source: rel?.url ?? '', editeur: rel ? String(Boolean(rel.checked)) : '' }, 'nouvelle ISO d\'Andromède pour Hydre', { interne: true }).catch(() => undefined);
    return undefined;
  },
  // Une nouvelle version remplace l'ancienne, qui part dans « old » (une seule ancienne gardée) ; les machines d'Hydre suivent.
  old: { deplace: async (ctx, l) => { await ctx.call('ymir', 'iso_deplacee', { liste: JSON.stringify(l) }, 'ISO remplacée par une nouvelle version', { interne: true }); } },
});

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
// « Envoyer à Hydre » : la fiche de l'ISO est faite dans la bibliothèque d'Hydre, sur place (pas de copie).
eitri.actions.push(
  { id: 'envoyer_hydre', label: 'Envoyer à Hydre', what: 'Rend une ISO de ce dossier disponible pour créer une machine virtuelle dans Hydre (sans copie : même espace ISO)',
    params: [{ key: 'chemin', label: 'Fichier ISO', kind: 'text', required: true }], words: ['envoie a hydre', 'envoyer a hydre'],
    run: async (ctx, i) => { const r = await ctx.call('ymir', 'ajouter_iso', { chemin: s(i.chemin) }, 'ISO envoyée par Andromède'); return { ok: r.ok, text: r.text, data: r.data }; } },
  { id: 'verification_iso', label: 'Planifier la vérification des ISO', what: 'Chaque mois par défaut : empreinte recalculée, antivirus, nouvelles versions (réglage commun avec Hydre)',
    params: [{ key: 'frequence', label: 'Fréquence', kind: 'select', options: ['mois', 'semaine', 'jour'], default: 'mois' }, { key: 'jour', label: 'Jour', kind: 'number', default: 1 }, { key: 'heure', label: 'Heure (HH:MM)', kind: 'text', default: '04:00' }],
    run: async (ctx, i) => { const r = await ctx.call('ymir', 'verification_iso', i, 'vérification des ISO planifiée dans Andromède', { interne: true }); return { ok: r.ok, text: r.text, data: r.data }; } },
  { id: 'verifier_isos', label: 'Vérifier toutes les ISO', what: 'Maintenant : empreinte, antivirus, nouvelles versions ; compte rendu', run: async (ctx) => { const r = await ctx.call('ymir', 'verifier_isos', {}, 'vérification des ISO lancée dans Andromède', { interne: true }); return { ok: r.ok, text: r.text, data: r.data }; } },
);

// L'onglet « ISO » (le même que dans Hydre) : l'emplacement des ISO (espace ISO commun), la bibliothèque avec la fiche
// de chaque ISO, et la vérification planifiée (mensuelle par défaut).
const vueForge = eitri.view.bind(eitri);
eitri.view = async (ctx, q): Promise<View> => {
  const v = await vueForge(ctx, q), I = 'ISO', M = 'Versions';
  const b = await ctx.call('ymir', 'bibliotheque_iso', {}, 'onglet ISO d\'Andromède', { interne: true }).catch(() => undefined);
  const p = await ctx.call('ymir', 'plan_verif_iso', {}, 'onglet ISO d\'Andromède', { interne: true }).catch(() => undefined);
  const l = ((b?.data as { isos?: Array<Record<string, unknown>> } | undefined)?.isos ?? []), pl = (p?.data ?? {}) as { frequence?: string; jour?: number; heure?: string };
  const go = (n: unknown) => `${(Number(n) / 1024 ** 3).toFixed(2).replace('.', ',')} Go`, d = (n: unknown) => (Number(n) ? new Date(Number(n)).toLocaleDateString('fr-FR') : '—');
  const av = (f: Record<string, unknown>) => s((f.antivirus as { verdict?: string } | undefined)?.verdict) || 'non analysé';
  return { ...v, onglets: [I, M], sections: [
    { kind: 'form', onglet: I, title: 'Emplacement des ISO (espace ISO, commun avec Hydre)', action: 'dossier', submit: 'Enregistrer', params: [{ key: 'chemin', label: 'Dossier (disque ou partage monté)', kind: 'text', required: true, default: s(ctx.settings.dossier) }], aide: 'Odin y range ses téléchargements et y reconnaît toute ISO déposée à la main.' },
    { kind: 'table', onglet: I, title: `Bibliothèque (${l.length} ISO)`, columns: ['ISO', 'Système', 'Version', 'Arch.', 'Édition', 'Taille', 'Ajoutée', 'Empreinte', 'Antivirus', 'Vérifiée', 'Machines'], empty: 'Aucune ISO dans l\'emplacement.',
      rows: l.map((f) => ({ cells: [s(f.nom), `${s(f.systeme)} · ${s(f.detail)}`, s(f.version) || '—', s(f.arch) || '—', s(f.edition) || '—', go(f.taille), d(f.ajoute), f.sha256 ? `${s(f.sha256).slice(0, 12)}…${f.editeur === true ? ' ✓ éditeur' : ''}` : '—', av(f), (f.verifiee as { at?: number } | undefined)?.at ? d((f.verifiee as { at: number }).at) : 'jamais', ((f.vms as string[] | undefined) ?? []).join(', ') || '—'],
        tone: av(f) === 'sain' ? 'bon' as const : 'neutre' as const, actions: [{ action: 'fiche_iso', label: 'Fiche', input: { iso: f.id }, module: 'ymir' }] })) },
    { kind: 'form', onglet: I, title: 'Vérification de toutes les ISO', action: 'verification_iso', submit: 'Planifier', params: [{ key: 'frequence', label: 'Fréquence', kind: 'select', options: ['mois', 'semaine', 'jour'], default: pl.frequence ?? 'mois' }, { key: 'jour', label: 'Jour (1 à 28 ; ou 0 = dimanche à 6 pour la semaine)', kind: 'number', default: pl.jour ?? 1 }, { key: 'heure', label: 'Heure', kind: 'text', default: pl.heure ?? '04:00' }], aide: p?.text ?? 'Empreinte recalculée, antivirus, nouvelles versions : un compte rendu à chaque passage.' },
    { kind: 'actions', onglet: I, title: 'Vérifier maintenant', boutons: [{ action: 'verifier_isos', label: 'Vérifier toutes les ISO', input: {} }] },
    ...v.sections.map((x) => ({ ...x, onglet: M })),
  ] };
};
