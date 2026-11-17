// draupnir : Odin crée et pilote ses propres automatisations (moteur Talos, intégré à Odin).
// « Chaque matin fais-moi le point », « quand un formulaire arrive, range-le dans Clients »… →
// une automatisation écrite par Odin, vérifiée, créée désactivée ; tu la testes puis « active-la ».

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ecrireJson } from '../draupnir/dossiers.ts';
import { flowFromDescription, templates, type Talos } from '../draupnir/service.ts';
import { CATALOG } from '../draupnir/nodes.ts';
import { obj, str, type Tool } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
let current: Talos | undefined;
export const setDraupnir = (d: Talos | undefined) => { current = d; };
export const draupnirOf = () => current;

// Ce qu'Odin a écrit lui-même (« creer », « modele ») et que le propriétaire n'a pas encore laissé partir : le lancer
// à la demande d'Odin demande l'accord, avec ce que l'automatisation va faire. Une fois lancée avec cet accord, elle
// est validée. La fonction « grave » ne sait pas de quelle conversation vient l'appel : la règle vaut pour toutes, ce
// qui est plus strict que « la même discussion ». La marque est écrite dans le dossier de Talos (elle tient après un
// redémarrage d'Odin) et gardée aussi en mémoire (si le fichier ne s'écrit pas, elle tient jusqu'au redémarrage).
const ecritesParOdin = new Set<string>();
const fichierMarques = (d: Talos) => join(d.dir, 'state', 'ecrites-par-odin.json');
function marques(d: Talos): Set<string> {
  const m = new Set(ecritesParOdin);
  try { const l: unknown = JSON.parse(readFileSync(fichierMarques(d), 'utf8')); if (Array.isArray(l)) for (const id of l) if (typeof id === 'string') m.add(id); } catch { /* aucun fichier : aucune marque écrite */ }
  return m;
}
function marquer(d: Talos, id: string, ecrite: boolean): void {
  if (ecrite) ecritesParOdin.add(id); else ecritesParOdin.delete(id);
  const m = marques(d); if (ecrite) m.add(id); else m.delete(id);
  try { ecrireJson(fichierMarques(d), [...m]); } catch { /* la marque reste en mémoire */ }
}
const hote = (u: unknown) => { try { return new URL(String(u ?? '')).host; } catch { return 'une adresse à calculer'; } };
/** Les blocs qui agissent ou qui sortent sur le réseau, en clair ; les autres (calculs, lectures, logique) n'engagent rien. */
const AGIT: Record<string, (p: Record<string, unknown>) => string | undefined> = {
  'web.requête': (p) => `appelle ${hote(p.url)} (${String(p.méthode ?? 'GET')})`,
  'web.flux': (p) => `lit un flux sur ${hote(p.url)}`,
  'odin.message': (p) => `envoie un message ${String(p.service ?? '')}`.trim(),
  'odin.mail': (p) => `envoie un mail à ${String(p.à ?? '?')}`,
  'odin.prévenir': () => 'te prévient sur ta messagerie',
  'odin.demander': (p) => (String(p.envoyer ?? 'non') === 'non' ? undefined : 'te renvoie la réponse d\'Odin'),
  'odin.agent': () => 'confie une tâche à l\'agent Odin (ses outils)',
  'saga.écrire': (p) => (String(p.mode ?? 'créer') === 'ajouter' ? 'ajoute du texte à une note de Thot' : 'écrit une note dans Thot'),
  'runes.ajouter': (p) => `ajoute une ligne à la base ${String(p.base ?? '')}`.trim(),
  'module.action': (p) => `lance l'action « ${String(p.action ?? '?')} » de l'appli ${String(p.module ?? '?')}`,
  'flux.exécuter': () => 'lance une autre automatisation',
  'données.code': () => 'exécute du code (isolé)',
  'web.répondre': () => 'répond au webhook',
};
/** Ce que l'automatisation fera, bloc par bloc (seulement ceux qui agissent) ; un type inconnu compte comme agissant. */
function ceQuiAgit(wf: { nodes: Array<{ name: string; type: string; params?: Record<string, unknown>; disabled?: boolean }> }): string[] {
  const out: string[] = [];
  for (const n of wf.nodes) {
    if (n.disabled || CATALOG.get(n.type)?.trigger) continue;
    const dit = AGIT[n.type] ? AGIT[n.type](n.params ?? {}) : CATALOG.has(n.type) ? undefined : `bloc inconnu (${n.type})`;
    if (dit) out.push(`${n.name} : ${dit}`);
  }
  return out;
}
function graveExecuter(id: string): string | undefined {
  const d = current, wf = d?.get(id); if (!d || !wf || !marques(d).has(wf.id)) return undefined;
  const agit = ceQuiAgit(wf); if (!agit.length) return undefined; // rien d'engageant : sans risque, comme avant
  return `lancer « ${wf.name} », une automatisation qu'Odin vient d'écrire et que tu n'as pas encore validée : ${agit.join(' ; ')}`;
}

export const draupnirTool: Tool = {
  name: 'draupnir',
  description: 'Automatisations d\'Odin (Talos, son propre moteur : déclencheurs planning, webhook, formulaire, Thot, flux RSS, page surveillée, erreur ; étapes Thot, Papyrus, Odin IA/agent, mail, messages, web, logique, données, code isolé). « creer » : une demande en français → automatisation vérifiée, créée désactivée. « modele » : modèle prêt. « lister », « voir », « activer », « desactiver », « executer » (test), « executions », « noeuds » (catalogue).',
  risk: 'exec',
  schema: obj({ action: { type: 'string', enum: ['creer', 'modele', 'lister', 'voir', 'activer', 'desactiver', 'executer', 'executions', 'noeuds'] }, description: str('pour creer : ce que l\'automatisation doit faire'), id: str('nom ou identifiant de l\'automatisation, ou du modèle') }, ['action']),
  summarize: (i) => `automatisation ${s(i.action)} ${s(i.description || i.id).slice(0, 100)}`,
  lookup: (i) => ['lister', 'voir', 'executions', 'noeuds'].includes(s(i.action)),
  // Activer une automatisation, c'est la laisser agir seule ensuite : toujours avec ton accord.
  // Et lancer une automatisation qu'Odin vient d'écrire lui-même, avant que tu l'aies validée.
  grave: (i) => (s(i.action) === 'activer' ? 'activer une automatisation la laisse agir seule' : s(i.action) === 'executer' ? graveExecuter(s(i.id)) : undefined),
  async run(i, ctx) {
    const d = current; if (!d) return 'Talos n\'est pas démarré (lance Odin avec l\'interface web).';
    const a = s(i.action), id = s(i.id);
    if (a === 'noeuds') return [...CATALOG.values()].map((n) => `- ${n.label} (${n.type}, ${n.group}) : ${n.what}`).join('\n');
    if (a === 'creer') {
      if (!ctx.llm) return 'Aucune IA disponible pour écrire l\'automatisation.';
      const draft = await flowFromDescription((sys, user) => ctx.llm!(sys, user, 6000), s(i.description));
      const wf = d.save({ ...draft, active: false });
      marquer(d, wf.id, true);
      return `✅ Automatisation « ${wf.name} » créée (désactivée) : ${wf.nodes.map((n) => n.name).join(' → ')}.\nOuvre Talos pour la voir et la tester, puis dis « active-la ».`;
    }
    if (a === 'modele') {
      const t = templates().find((x) => x.id === id || x.name.toLowerCase() === id.toLowerCase());
      if (!t) return `Modèles : ${templates().map((x) => `${x.id} (${x.what})`).join(' ; ')}.`;
      const wf = d.save({ ...t.flow, active: false });
      marquer(d, wf.id, true);
      return `✅ Modèle « ${wf.name} » ajouté (désactivé). ${t.what}`;
    }
    if (a === 'lister') { const l = d.list(); return l.length ? l.map((w) => `- ${w.active ? '🟢' : '⚪'} ${w.name} · ${w.nodes.length} étapes${d.runs(w.id, 1)[0] ? ` · dernière : ${d.runs(w.id, 1)[0].status}` : ''}`).join('\n') : 'Aucune automatisation pour l\'instant.'; }
    const wf = d.get(id); if (!wf) return `Automatisation introuvable : ${id}`;
    if (a === 'voir') return `${wf.name} (${wf.active ? 'active' : 'désactivée'})\n${wf.nodes.map((n) => `- ${n.name} : ${CATALOG.get(n.type)?.label ?? n.type}${n.disabled ? ' (désactivé)' : ''}`).join('\n')}`;
    if (a === 'activer' || a === 'desactiver') { const w = d.setActive(wf.id, a === 'activer'); return `${w.active ? '🟢 Activée' : '⚪ Désactivée'} : ${w.name}`; }
    // L'outil ne tourne qu'après la décision de Heimdall : si l'accord était demandé, il est donné → validée.
    if (a === 'executer') { marquer(d, wf.id, false); const ex = await d.run(wf.id, undefined, 'test'); return `${ex.status === 'succès' ? '✅' : '⚠️'} ${wf.name} : ${ex.status}${ex.error ? ` (${ex.failedNode} : ${ex.error})` : ''} en ${ex.ms} ms\n${Object.entries(ex.nodes).map(([k, v]) => `- ${k} : ${v.count} élément(s)${v.error ? ` ✗ ${v.error}` : ''}`).join('\n')}`; }
    if (a === 'executions') { const r = d.runs(wf.id, 10); return r.length ? r.map((e) => `- ${e.startedAt.slice(0, 16).replace('T', ' ')} · ${e.status}${e.error ? ` · ${e.failedNode} : ${e.error}` : ''}`).join('\n') : 'Aucune exécution.'; }
    return 'action inconnue';
  },
};
