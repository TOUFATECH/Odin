// Archytas, l'appli d'Odin : « mes scripts » / « la fenêtre Script ». Odin fabrique des scripts (suites
// d'actions de ses applis, avec conditions, variables et déclencheurs), les garde, les lance, les suit et les
// améliore. Comme toute appli : des actions (aussi pour Odin, Talos et le mode sans IA), une page, des tâches
// Talos (déclencheurs horaires), des mots-clés. PLUS une tuile « Script » toujours visible (côté interface).
//
// SÉCURITÉ : un script n'atteint les applis QUE par le pont `appeler`, routé vers v.act({ auto:true,
// by:'automatisation' }) — une action grave y est refusée. On ne remet JAMAIS ctx.call ni un ModCtx au moteur.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, Kpi, ModCtx, Module, RythmeAppli, Section, TacheAppli, View } from '../types.ts';
import { valhallaOf } from '../odin.ts';
import { NAMES } from '../names.ts';
import { EntrepotFichiers } from './base.ts';
import { creerMoteur, REGLAGES_DEFAUT, type Appeler, type Declencheur, type MoteurArchytas, type Reglages, type ScriptResume } from './scripts.ts';
import { lienArchytas } from './liens.ts';
import { creerBacWorker } from './bacasable.ts';
import { proposeurLocal } from './amelioration.ts';

const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v)).trim();
const n = (v: unknown, def: number): number => { const x = Number(v); return Number.isFinite(x) ? x : def; };

/** Les réglages de l'appli (lus dans ses settings, bornes sûres). */
function reglagesDe(home: string): Reglages {
  const v = valhallaOf();
  const st = (v?.module('archytas') ? v.ctx('archytas').settings : {}) as Record<string, unknown>;
  return {
    codeLibre: st.codeLibre === true,
    maxWorkers: 1,
    budgetMs: Math.min(10_000, Math.max(200, n(st.budgetMs, REGLAGES_DEFAUT.budgetMs))),
    budgetMo: Math.min(256, Math.max(16, n(st.budgetMo, REGLAGES_DEFAUT.budgetMo))),
    maxAppels: Math.min(500, Math.max(1, n(st.maxAppels, REGLAGES_DEFAUT.maxAppels))),
    maxBoucles: Math.min(1_000_000, Math.max(100, n(st.maxBoucles, REGLAGES_DEFAUT.maxBoucles))),
  };
}

/** Le pont unique vers les applis : v.act({ auto:true, by:'automatisation' }) — grave refusée, note des manips, undo. */
const appelerActions: Appeler = async (module, action, entree) => {
  const v = valhallaOf();
  if (!v) return { ok: false, texte: 'Les applis d\'Odin ne sont pas démarrées.' };
  try { const r = await v.act(module, action, entree ?? {}, { auto: true, by: 'automatisation' }); return { ok: r.ok !== false, texte: String(r.text ?? '') }; }
  catch (e) { return { ok: false, texte: (e as Error).message }; }
};

// Un moteur par dossier d'Odin (home), avec son entrepôt en fichiers (code chiffré) et le lien « gardé de partout ».
const moteurs = new Map<string, MoteurArchytas>();
export function moteurPour(home: string): MoteurArchytas {
  let m = moteurs.get(home);
  if (!m) {
    m = creerMoteur({
      entrepot: new EntrepotFichiers(home),
      appeler: appelerActions,
      bac: creerBacWorker(() => ({ budgetMo: reglagesDe(home).budgetMo })),
      proposeur: proposeurLocal(),
      lien: lienArchytas,
      reglages: () => reglagesDe(home),
    });
    moteurs.set(home, m);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------
// Les actions de l'appli (aussi utilisables par Odin, Talos et le mode sans IA).
// ---------------------------------------------------------------------------------------------------------
const lireEntree = (i: Record<string, unknown>): Record<string, unknown> => { try { const j = typeof i.entree === 'string' ? JSON.parse(i.entree) : i.entree; return j && typeof j === 'object' ? j as Record<string, unknown> : {}; } catch { return {}; } };

/** Le genre d'un script, lu vite sur le disque (sync) : sert à marquer « lancer » comme grave pour le code. */
function genreDeScript(home: string, nom: string): 'declaratif' | 'code' | undefined {
  const dir = join(home, 'valhalla', 'archytas', 'scripts');
  if (!nom || !existsSync(dir)) return undefined;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { nom?: string; genre?: string }; if (r.nom === nom) return r.genre === 'code' ? 'code' : 'declaratif'; } catch { /* illisible : ignoré */ }
  }
  return undefined;
}

const actions: Action[] = [
  { id: 'mes_scripts', label: 'Mes scripts', what: 'La liste de mes scripts (nom, mission, dates, usage)', read: true, words: ['mes scripts', 'liste des scripts', 'quels scripts'], run: async (ctx) => {
    const l = await moteurPour(ctx.home).lister();
    return { text: l.length ? l.map((x) => `- ${x.nom} — ${x.mission || x.description} · ${x.stat.runs} usage(s)`).join('\n') : 'Aucun script pour l\'instant.', data: l };
  } },
  { id: 'voir_script', label: 'Voir un script', what: 'Ce qu\'un script fait (sa mission, ses étapes)', read: true, params: [{ key: 'nom', label: 'Nom du script', kind: 'text', required: true }], run: async (ctx, i) => {
    const d = await moteurPour(ctx.home).voir(s(i.nom)); if (!d) return { text: `Aucun script « ${s(i.nom)} ».`, ok: false };
    return { text: `${d.nom} — ${d.mission}\n${d.description}\nGenre : ${d.genre}, version ${d.version}, ${d.stat.runs} usage(s).`, data: d };
  } },
  { id: 'lancer', label: 'Lancer un script', what: 'Exécute un script (ses actions passent par les permissions ; une action grave est refusée sans toi)', words: ['lance le script', 'exécute le script', 'lancer un script'],
    // Un script « code » est du JS qui s'exécute : grave, donc refusé sans toi (jamais depuis une automatisation
    // ni un autre script). Un flag global « code libre » n'est pas un accord permanent par exécution.
    grave: (i, ctx) => ctx && genreDeScript(ctx.home, s(i.nom)) === 'code' ? `lancer le script « code libre » « ${s(i.nom)} » (du code qui s'exécute)` : undefined,
    params: [{ key: 'nom', label: 'Nom du script', kind: 'text', required: true }, { key: 'entree', label: 'Entrée (JSON, facultatif)', kind: 'textarea', default: '' }], run: async (ctx, i) => {
    const r = await moteurPour(ctx.home).lancer(s(i.nom), lireEntree(i));
    return { text: r.texte, ok: r.ok };
  } },
  { id: 'creer', label: 'Créer un script', what: 'Fabrique un script (déclaratif par défaut : des étapes, pas de code)', quick: false,
    grave: () => 'créer un script qui pourra agir avec tes applis',
    params: [{ key: 'nom', label: 'Nom (tiré de sa mission)', kind: 'text', required: true }, { key: 'mission', label: 'Mission', kind: 'text', required: true }, { key: 'description', label: 'Description', kind: 'textarea', default: '' }, { key: 'etapes', label: 'Étapes (JSON)', kind: 'textarea', default: '[]' }],
    run: async (ctx, i) => {
      let etapes: unknown = []; try { etapes = JSON.parse(s(i.etapes) || '[]'); } catch { return { text: 'Les étapes doivent être du JSON.', ok: false }; }
      const r = await moteurPour(ctx.home).creer({ nom: s(i.nom), mission: s(i.mission), description: s(i.description), genre: 'declaratif', etapes: Array.isArray(etapes) ? etapes as never : [], declencheurs: [{ genre: 'manuel' }] });
      return { text: `Script « ${r.nom} » créé.`, data: r };
    } },
  { id: 'supprimer', label: 'Supprimer un script', what: 'Enlève un script (et sa trace en mémoire et au Cerveau)', quick: false,
    grave: (i) => `supprimer le script « ${s(i.nom)} » définitivement`,
    params: [{ key: 'nom', label: 'Nom du script', kind: 'text', required: true }], run: async (ctx, i) => {
      await moteurPour(ctx.home).supprimer(s(i.nom)); return { text: `Script « ${s(i.nom)} » supprimé.` };
    } },
  { id: 'versions', label: 'Versions d\'un script', what: 'L\'historique des versions d\'un script', read: true, params: [{ key: 'nom', label: 'Nom du script', kind: 'text', required: true }], run: async (ctx, i) => {
    const v = await moteurPour(ctx.home).versions(s(i.nom));
    return { text: v.length ? v.map((x) => `- v${x.version} (${new Date(x.at).toLocaleDateString('fr-FR')}) : ${x.change}`).join('\n') : 'Aucune version.', data: v };
  } },
  { id: 'revenir', label: 'Revenir à une version', what: 'Remet un script à une version précédente', quick: false,
    grave: (i) => `remplacer le script « ${s(i.nom)} » par sa version ${s(i.version)}`,
    params: [{ key: 'nom', label: 'Nom du script', kind: 'text', required: true }, { key: 'version', label: 'Version', kind: 'number', required: true }], run: async (ctx, i) => {
      const r = await moteurPour(ctx.home).revenir(s(i.nom), n(i.version, 0)); return { text: `« ${r.nom} » revenu (version ${r.version}).`, data: r };
    } },
  { id: 'proposer_amelioration', label: 'Proposer une amélioration', what: 'Odin propose une version améliorée (sans la remplacer)', read: true, params: [{ key: 'nom', label: 'Nom du script', kind: 'text', required: true }], run: async (ctx, i) => {
    const p = await moteurPour(ctx.home).proposerAmelioration(s(i.nom));
    return { text: p ? `${p.pourquoi} (${p.apercuChange})` : 'Rien à améliorer sûrement pour l\'instant.', data: p ?? null };
  } },
  { id: 'appliquer_amelioration', label: 'Appliquer l\'amélioration', what: 'Remplace le script par la version améliorée (seulement si même comportement, sinon ton accord)', quick: false,
    grave: (i) => `remplacer le script actif « ${s(i.nom)} » par une version améliorée`,
    params: [{ key: 'nom', label: 'Nom du script', kind: 'text', required: true }], run: async (ctx, i) => {
      const r = await moteurPour(ctx.home).appliquerAmelioration(s(i.nom), true); return { text: `« ${r.nom} » amélioré (version ${r.version}).`, data: r };
    } },
];

// ---------------------------------------------------------------------------------------------------------
// Les tâches Talos : chaque script avec un déclencheur horaire devient une tâche à rythme (lue sur le disque,
// sans réveiller le moteur). Talos les montre et peut les lancer.
// ---------------------------------------------------------------------------------------------------------
interface ScriptHoraire { nom: string; mission: string; rythme: string; actif: boolean }
function scriptsHoraires(home: string): ScriptHoraire[] {
  const dir = join(home, 'valhalla', 'archytas', 'scripts');
  if (!existsSync(dir)) return [];
  const out: ScriptHoraire[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { nom?: string; mission?: string; genre?: string; actif?: boolean; declencheurs?: Declencheur[] };
      // SÉCURITÉ : un script « code » ne devient JAMAIS une tâche Talos (elle tournerait sans personne, as 'toi').
      // Le code libre ne s'exécute qu'à la demande du propriétaire (fenêtre Script) ; seul le déclaratif s'automatise.
      if (r.genre === 'code') continue;
      const h = (r.declencheurs ?? []).find((d): d is Extract<Declencheur, { genre: 'horaire' }> => d.genre === 'horaire');
      if (r.nom && h) out.push({ nom: r.nom, mission: r.mission ?? '', rythme: h.rythme, actif: r.actif !== false });
    } catch { /* fichier illisible : ignoré */ }
  }
  return out;
}
const tachesArchytas = (ctx: ModCtx): TacheAppli[] => scriptsHoraires(ctx.home).map((sc) => ({
  id: `script-${sc.nom.replace(/[^\w-]/g, '_').slice(0, 60)}`,
  nom: `Script : ${sc.nom}`,
  quoi: sc.mission || `Lance le script « ${sc.nom} ».`,
  rythme: (): RythmeAppli => ({ genre: 'libre', texte: sc.rythme }),
  lancer: { action: 'lancer', input: { nom: sc.nom } },
}));

// ---------------------------------------------------------------------------------------------------------
// La page (vue générique) : liste des scripts, suivi, graphe, et la petite fenêtre latérale des noms.
// ---------------------------------------------------------------------------------------------------------
const date = (ms?: number): string => (ms ? new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

async function vue(ctx: ModCtx): Promise<View> {
  const m = moteurPour(ctx.home);
  const [scripts, suivi, graphe] = await Promise.all([m.lister(), m.suivi(), m.graphe()]);
  const reg = reglagesDe(ctx.home);
  const runs = scripts.reduce((a, x) => a + x.stat.runs, 0), oks = scripts.reduce((a, x) => a + x.stat.ok, 0);
  const kpis: Kpi[] = [
    { label: 'Scripts', value: String(scripts.length), tone: 'neutre' },
    { label: 'Exécutions', value: String(runs), tone: 'neutre' },
    { label: 'Réussite', value: runs ? `${Math.round((oks / runs) * 100)} %` : '—', tone: runs && oks / runs < 0.8 ? 'attention' : 'bon' },
    { label: 'Jamais servis', value: String(suivi.jamais.length), tone: suivi.jamais.length ? 'attention' : 'bon' },
  ];
  const ligneScript = (x: ScriptResume): { cells: string[]; actions: Array<{ action: string; label: string; input: Record<string, unknown> }> } => ({
    cells: [x.nom, x.mission || x.description, `${x.genre === 'code' ? 'code' : 'étapes'}`, String(x.stat.runs), `${x.stat.runs ? Math.round((x.stat.ok / x.stat.runs) * 100) : 0} %`, date(x.dernierUsage), date(x.cree)],
    actions: [{ action: 'lancer', label: 'Lancer', input: { nom: x.nom } }, { action: 'voir_script', label: 'Voir', input: { nom: x.nom } }],
  });

  const sections: Section[] = [
    { onglet: 'Scripts', kind: 'table', title: 'Tous les scripts', columns: ['Nom', 'Mission', 'Genre', 'Usages', 'Réussite', 'Dernier', 'Créé'], empty: 'Aucun script. Odin en fabrique dès que tu lui demandes une automatisation.', rows: scripts.map(ligneScript) },
    { onglet: 'Suivi', kind: 'table', title: 'Les plus utilisés', columns: ['Nom', 'Mission', 'Usages', 'Réussite'], empty: 'Aucun script lancé.', rows: suivi.plusUtilises.map((x) => ({ cells: [x.nom, x.mission, String(x.stat.runs), `${x.stat.runs ? Math.round((x.stat.ok / x.stat.runs) * 100) : 0} %`] })) },
    { onglet: 'Suivi', kind: 'list', title: 'Jamais servis', items: suivi.jamais.map((x) => ({ title: x.nom, detail: x.mission, meta: `créé ${date(x.cree)}` })), empty: 'Tous les scripts ont déjà servi.' },
    // Le graphe des scripts (placés selon leur usage et leur fraîcheur). 3D léger côté page dédiée ; ici la
    // vue générique dessine le même graphe en 2D (repli honnête sans carte graphique).
    { onglet: 'Graphe', kind: 'graph', title: 'Carte des scripts (usage et fraîcheur)',
      nodes: graphe.nodes.map((nd) => ({ id: nd.id, label: nd.label, sub: nd.sub, color: nd.color, size: nd.size })),
      edges: graphe.edges.map(([a, b]) => ({ a, b })),
      details: Object.fromEntries(scripts.map((x) => [x.nom, { kind: 'script', title: x.nom, subtitle: x.mission, rows: [{ k: 'Usages', v: String(x.stat.runs) }, { k: 'Réussite', v: `${x.stat.runs ? Math.round((x.stat.ok / x.stat.runs) * 100) : 0} %` }, { k: 'Dernier', v: date(x.dernierUsage) }, { k: 'Genre', v: x.genre }], actions: [{ action: 'lancer', label: 'Lancer', input: { nom: x.nom }, primary: true }, { action: 'voir_script', label: 'Voir', input: { nom: x.nom } }] }])),
      legend: [['#39c17f', 'récent et utilisé'], ['#e0a23a', 'tiède'], ['#c05b5b', 'ancien'], ['#9aa4b2', 'jamais servi']], empty: 'Aucun script à placer.' },
  ];
  // La petite fenêtre latérale : tous les NOMS de scripts, cliquables (voir), avec « Éditer » à côté.
  const side: Section[] = [
    { onglet: 'Scripts', kind: 'list', title: 'Tous les noms', items: scripts.map((x) => ({ title: x.nom, detail: `${x.stat.runs} usage(s)`, meta: x.genre })), empty: 'Aucun script.', aide: 'Clique un script pour le voir ; « Éditer » pour le modifier à la main (page Script).' },
    { onglet: 'Scripts', kind: 'text', title: 'Code libre', text: reg.codeLibre ? 'Le code libre est activé. Ce n\'est PAS une barrière de sécurité : du code libre peut atteindre ta machine. À n\'activer que pour du code que TU as écrit et relu.' : 'Par défaut, les scripts sont déclaratifs (des étapes, aucun code exécuté : zéro surface d\'évasion). Le code libre reste désactivé.' },
    { onglet: 'Graphe', kind: 'text', title: 'La vue 3D', text: 'Vue 3D légère, sans carte graphique (faux-3D sur toile 2D), sur la page Script. Repli automatique en 2D si ça rame — ici, la carte 2D du graphe.' },
  ];
  return { subtitle: `${scripts.length} script(s) · ${runs} exécution(s)`, kpis, onglets: ['Scripts', 'Suivi', 'Graphe'], sections, side };
}

export const archytas: Module = {
  id: 'archytas', name: NAMES.archytas ?? 'Archytas', family: 'Données',
  what: 'La fenêtre Script : Odin fabrique des scripts et des automatisations avec ses applis (suites d\'actions, conditions, variables, déclencheurs), les garde, laisse une trace datée, les relie à sa mémoire, à son Cerveau et à Noûs, les suit (plus/moins utilisés, récents, anciens) sur un graphe, et les améliore — sans jamais sortir du bac à sable ni dépendre d\'un service extérieur.',
  does: [
    'créer un script : un nom tiré de sa mission, une description, ses étapes (action d\'appli, condition, variable), ses déclencheurs (manuel, horaire via Talos, sur événement d\'une appli)',
    'lancer un script en sécurité : ses actions passent par les permissions (Heimdall + niveau d\'autonomie), une action grave est refusée sans ton accord',
    'déclaratif par défaut (aucun code exécuté) ; code libre en option, isolé dans un bac à sable borné, à n\'activer que pour du code relu',
    'garder chaque script de partout : base chiffrée, mémoire (Mnémosyne), Cerveau (une note reliée aux fiches des applis), Noûs',
    'suivre les scripts : quel est le plus utilisé, les plus récents, les plus anciens, ceux jamais servis — tout daté, sur un graphe',
    'améliorer en continu : à chaque usage on mesure ; Odin propose une version meilleure ; elle ne remplace l\'ancienne que si elle garde le même comportement (porte de qualité), versions gardées, retour arrière possible',
    'éditer un script à la main, revenir à une version précédente, supprimer un script',
  ],
  from: [], upstream: [],
  words: ['mes scripts', 'script', 'scripts', 'fenêtre script', 'mes automatisations', 'automatisation à moi', 'créer un script', 'crée un script', 'écris un script', 'écrire un script', 'archytas', 'automatiser', 'mes macros'],
  actions,
  taches: tachesArchytas,
  view: (ctx) => vue(ctx),
};
