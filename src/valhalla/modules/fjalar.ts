// Hermès · les logiciels : un dossier d'installateurs (disque ou partage réseau) gardé à jour depuis les sites
// officiels des éditeurs ou leurs dépôts GitHub, empreinte vérifiée, antivirus d'abord (Asclépios). Une nouvelle
// version remplace l'ancienne, qui part dans « old » (une seule ancienne gardée). Le dossier est aussi une
// bibliothèque (le même code que celle des ISO) : tout installateur trouvé, même déposé à la main, y entre avec sa
// fiche (icône, éditeur, version, système visé, empreinte, antivirus, machines où il est installé), et la
// bibliothèque est vérifiée chaque mois par défaut.
// Reprend les idées de Ketarin, WingetUI / UniGetUI et Chocolatey (dossier d'installateurs), réécrit pour Odin.
import { join } from 'node:path';
import { actionsBibliotheque, Bibliotheque, cartes, surveiller } from '../forge/bibliotheque.ts';
import { forgeModule } from '../forge/forge.ts';
import { GENRE_LOGICIEL } from '../forge/logiciels.ts';
import { SOFT } from '../forge/sources.ts';
import type { ModCtx, View } from '../types.ts';
import { quarantaineDabord } from '../ullr/garde.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
/** Le dossier des logiciels (réglage d'Hermès, distinct de l'espace ISO). */
export const dossierLogiciels = (ctx: ModCtx) => s(ctx.settings.dossier) || join(ctx.home, 'Logiciels');
const biblio = (ctx: ModCtx) => new Bibliotheque(ctx, GENRE_LOGICIEL, dossierLogiciels(ctx));
/** Les machines d'Hydre où chaque logiciel est installé (par nom de produit). */
async function installes(ctx: ModCtx): Promise<Map<string, string[]>> {
  const r = await ctx.call('ymir', 'locales', {}, 'où sont installés les logiciels', { interne: true });
  const m = new Map<string, string[]>();
  for (const x of (r.data as Array<{ nom: string; logiciels?: Array<{ nom: string; source: string }> }> | undefined) ?? []) for (const l of x.logiciels ?? []) for (const k of [l.nom, l.source]) m.set(k, [...(m.get(k) ?? []), x.nom]);
  return m;
}
const nouvelles = async (ctx: ModCtx) => { const r = await ctx.call('fjalar', 'verifier', {}, 'vérification des logiciels : nouvelles versions', { interne: true }); return r.text.split('\n').filter((x) => x.startsWith('🆕')).join('\n'); };

export const fjalar = forgeModule({
  id: 'fjalar', name: 'Hermès', kind: 'logiciel', noun: 'logiciel', nouns: 'logiciels', defaultDir: 'Logiciels',
  what: 'Les logiciels : un dossier d\'installateurs (disque ou partage réseau) gardé à jour depuis les sites officiels, aux jours que tu programmes, analysé par l\'antivirus ; l\'ancienne version part dans « old ».',
  from: ['Ketarin', 'UniGetUI', 'Chocolatey'], upstream: ['canneverbe/Ketarin', 'marticliment/UniGetUI', 'chocolatey/choco'],
  words: ['logiciels', 'installateurs', 'installateur', 'setup', 'programmes à installer', 'ketarin', 'mise à jour des logiciels', 'firefox', 'vlc', '7-zip'],
  sources: SOFT,
  extraDoes: ['chaque installateur téléchargé passe par l\'antivirus (Asclépios) : s\'il est dangereux, il part en quarantaine et ne remplace pas l\'ancien', 'bibliothèque : tout installateur du dossier, même déposé à la main, a sa fiche (icône, éditeur, version, système visé, empreinte, antivirus)', 'vérification de toute la bibliothèque, mensuelle par défaut', 'installation dans les machines d\'Hydre, puis leurs mises à jour'],
  // Quarantaine d'abord : un installateur dangereux part en quarantaine (Asclépios) et ne remplace pas l'ancien ;
  // un installateur sain entre dans la bibliothèque avec sa fiche.
  after: async (ctx, path, _src, rel) => {
    // Le verdict détaillé d'Asclépios (réflexe noté), puis le point de passage commun : dangereux → quarantaine.
    const r = await ctx.call('ullr', 'fichier', { chemin: path }, 'vérifier un installateur téléchargé');
    const v = r.data as { level?: string; findings?: Array<{ threat?: string; name?: string }> } | undefined;
    const p = await quarantaineDabord({ fichier: path, origine: 'Hermès · logiciel téléchargé', source: rel?.url, usage: 'l\'installer' }, ctx);
    if (p.bloque) return p.menace ?? 'menace';
    if (v?.level && ['moyenne', 'haute', 'critique'].includes(v.level)) return v.findings?.map((f) => f.threat ?? f.name).filter(Boolean).join(', ') || v.level;
    await biblio(ctx).importer(path, { origine: 'hermes', source: rel?.url, page: rel?.page, editeur: rel ? Boolean(rel.checked) : undefined }).catch(() => undefined);
    return undefined;
  },
  old: { deplace: async (ctx, l) => { const b = biblio(ctx); for (const d of l) b.deplacee(d.de, d.vers); } },
});

fjalar.actions.push(...actionsBibliotheque({ genre: GENRE_LOGICIEL, racine: dossierLogiciels, nouvelles, utilisePar: installes }).map((a) => ({ ...a, id: a.id === 'bibliotheque' ? 'bibliotheque_logiciels' : a.id === 'fiche' ? 'fiche_logiciel' : a.id === 'importer' ? 'importer_logiciel' : a.id === 'verification' ? 'verification_logiciels' : a.id === 'verifier_tout' ? 'verifier_logiciels' : a.id === 'plan_verification' ? 'plan_verification_logiciels' : a.id })));

// L'onglet « Logiciels » : le dossier, la bibliothèque (icône, version, éditeur, état), la vérification planifiée.
const vueForge = fjalar.view.bind(fjalar);
fjalar.view = async (ctx, q): Promise<View> => {
  const v = await vueForge(ctx, q), L = 'Logiciels', M = 'Versions', b = biblio(ctx), l = await b.liste(), u = await installes(ctx).catch(() => new Map<string, string[]>()), p = b.plan();
  for (const f of l) f.utilisePar = u.get(f.produit ?? '') ?? [];
  const enCours = b.enCours();
  return { ...v, onglets: [L, M], sections: [
    { kind: 'form', onglet: L, title: 'Dossier des logiciels', action: 'dossier', submit: 'Enregistrer', params: [{ key: 'chemin', label: 'Dossier (disque ou partage monté)', kind: 'text', required: true, default: dossierLogiciels(ctx) }], aide: 'Odin y range ses téléchargements et y reconnaît tout installateur déposé à la main (exe, msi, msix, dmg, pkg, deb, rpm, AppImage, apk, zip).' },
    cartes(l, GENRE_LOGICIEL, { fiche: 'fiche_logiciel', onglet: L }),
    ...(enCours.length ? [{ kind: 'list' as const, onglet: L, title: 'En cours', items: enCours.map((x) => ({ title: x.nom, detail: `${Math.round(x.recu / 1024 ** 2)} Mo reçus · pas utilisable avant la fin et l'antivirus` })) }] : []),
    { kind: 'form', onglet: L, title: 'Vérification de toute la bibliothèque', action: 'verification_logiciels', submit: 'Planifier', params: [{ key: 'frequence', label: 'Fréquence', kind: 'select', options: ['mois', 'semaine', 'jour'], default: p.frequence }, { key: 'jour', label: 'Jour (1 à 28 ; ou 0 = dimanche à 6)', kind: 'number', default: p.jour }, { key: 'heure', label: 'Heure', kind: 'text', default: p.heure }], aide: 'Empreinte recalculée, antivirus, nouvelles versions : un compte rendu à chaque passage.' },
    { kind: 'form', onglet: L, title: 'Importer un logiciel', action: 'importer_logiciel', submit: 'Importer', params: [{ key: 'lien', label: 'Lien http(s)', kind: 'text', default: '' }, { key: 'chemin', label: 'Ou un fichier (ce PC, partage monté)', kind: 'text', default: '' }] },
    ...v.sections.map((x) => ({ ...x, onglet: M })),
  ] };
};
// Surveillance : en plus des passages de la forge, le scan du dossier et la vérification planifiée.
const veille = fjalar.watch!.run.bind(fjalar.watch);
fjalar.watch = { every: fjalar.watch!.every, async run(ctx) { await veille(ctx); await surveiller(ctx, GENRE_LOGICIEL, dossierLogiciels(ctx), () => nouvelles(ctx)).catch(() => undefined); } };
