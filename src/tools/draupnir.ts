// draupnir : Odin crée et pilote ses propres automatisations (moteur Draupnir, intégré à Odin).
// « Chaque matin fais-moi le point », « quand un formulaire arrive, range-le dans Clients »… →
// une automatisation écrite par Odin, vérifiée, créée désactivée ; tu la testes puis « active-la ».

import { flowFromDescription, templates, type Draupnir } from '../draupnir/service.ts';
import { CATALOG } from '../draupnir/nodes.ts';
import { obj, str, type Tool } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
let current: Draupnir | undefined;
export const setDraupnir = (d: Draupnir | undefined) => { current = d; };
export const draupnirOf = () => current;

export const draupnirTool: Tool = {
  name: 'draupnir',
  description: 'Automatisations d\'Odin (Draupnir, son propre moteur : déclencheurs planning, webhook, formulaire, Saga, flux RSS, page surveillée, erreur ; étapes Saga, Runes, Odin IA/agent, mail, messages, web, logique, données, code isolé). « creer » : une demande en français → automatisation vérifiée, créée désactivée. « modele » : modèle prêt. « lister », « voir », « activer », « desactiver », « executer » (test), « executions », « noeuds » (catalogue).',
  risk: 'exec',
  schema: obj({ action: { type: 'string', enum: ['creer', 'modele', 'lister', 'voir', 'activer', 'desactiver', 'executer', 'executions', 'noeuds'] }, description: str('pour creer : ce que l\'automatisation doit faire'), id: str('nom ou identifiant de l\'automatisation, ou du modèle') }, ['action']),
  summarize: (i) => `automatisation ${s(i.action)} ${s(i.description || i.id).slice(0, 100)}`,
  lookup: (i) => ['lister', 'voir', 'executions', 'noeuds'].includes(s(i.action)),
  // Activer une automatisation, c'est la laisser agir seule ensuite : toujours avec ton accord.
  grave: (i) => (s(i.action) === 'activer' ? 'activer une automatisation la laisse agir seule' : undefined),
  async run(i, ctx) {
    const d = current; if (!d) return 'Draupnir n\'est pas démarré (lance Odin avec l\'interface web).';
    const a = s(i.action), id = s(i.id);
    if (a === 'noeuds') return [...CATALOG.values()].map((n) => `- ${n.label} (${n.type}, ${n.group}) : ${n.what}`).join('\n');
    if (a === 'creer') {
      if (!ctx.llm) return 'Aucune IA disponible pour écrire l\'automatisation.';
      const draft = await flowFromDescription((sys, user) => ctx.llm!(sys, user, 6000), s(i.description));
      const wf = d.save({ ...draft, active: false });
      return `✅ Automatisation « ${wf.name} » créée (désactivée) : ${wf.nodes.map((n) => n.name).join(' → ')}.\nOuvre Draupnir pour la voir et la tester, puis dis « active-la ».`;
    }
    if (a === 'modele') {
      const t = templates().find((x) => x.id === id || x.name.toLowerCase() === id.toLowerCase());
      if (!t) return `Modèles : ${templates().map((x) => `${x.id} (${x.what})`).join(' ; ')}.`;
      const wf = d.save({ ...t.flow, active: false });
      return `✅ Modèle « ${wf.name} » ajouté (désactivé). ${t.what}`;
    }
    if (a === 'lister') { const l = d.list(); return l.length ? l.map((w) => `- ${w.active ? '🟢' : '⚪'} ${w.name} · ${w.nodes.length} étapes${d.runs(w.id, 1)[0] ? ` · dernière : ${d.runs(w.id, 1)[0].status}` : ''}`).join('\n') : 'Aucune automatisation pour l\'instant.'; }
    const wf = d.get(id); if (!wf) return `Automatisation introuvable : ${id}`;
    if (a === 'voir') return `${wf.name} (${wf.active ? 'active' : 'désactivée'})\n${wf.nodes.map((n) => `- ${n.name} : ${CATALOG.get(n.type)?.label ?? n.type}${n.disabled ? ' (désactivé)' : ''}`).join('\n')}`;
    if (a === 'activer' || a === 'desactiver') { const w = d.setActive(wf.id, a === 'activer'); return `${w.active ? '🟢 Activée' : '⚪ Désactivée'} : ${w.name}`; }
    if (a === 'executer') { const ex = await d.run(wf.id, undefined, 'test'); return `${ex.status === 'succès' ? '✅' : '⚠️'} ${wf.name} : ${ex.status}${ex.error ? ` (${ex.failedNode} : ${ex.error})` : ''} en ${ex.ms} ms\n${Object.entries(ex.nodes).map(([k, v]) => `- ${k} : ${v.count} élément(s)${v.error ? ` ✗ ${v.error}` : ''}`).join('\n')}`; }
    if (a === 'executions') { const r = d.runs(wf.id, 10); return r.length ? r.map((e) => `- ${e.startedAt.slice(0, 16).replace('T', ' ')} · ${e.status}${e.error ? ` · ${e.failedNode} : ${e.error}` : ''}`).join('\n') : 'Aucune exécution.'; }
    return 'action inconnue';
  },
};
