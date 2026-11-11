// automatisation : Odin crée et gère tes automatisations dans n8n (installé sur sa machine).
// « Quand je reçois une facture par mail, range-la dans le Cerveau » → un workflow n8n, créé
// désactivé ; tu testes, puis « active-la ».

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkWorkflow, composeFile, createWorkflow, hookToken, lanIp, listExecutions, listWorkflows, n8nStatus, setActive, templates, workflowPrompt, type N8nCfg } from '../automation/n8n.ts';
import type { OdinConfig } from '../config.ts';
import { dockerIn, ensureDocker } from './apps.ts';
import { obj, str, type Tool, type ToolContext } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
export const n8nCfg = (cfg?: OdinConfig): N8nCfg => ({ url: cfg?.automation?.n8nUrl || 'http://127.0.0.1:5678', key: process.env.N8N_API_KEY });
/** Adresse d'Odin vue depuis n8n (conteneur sur la même machine : host.docker.internal). */
export function odinUrlForN8n(cfg?: OdinConfig): string {
  const web = cfg?.web, proto = web?.tls?.enabled === false ? 'http' : 'https', port = web?.port ?? 7777;
  const local = /127\.0\.0\.1|localhost/.test(n8nCfg(cfg).url);
  return local ? `${proto}://host.docker.internal:${port}` : `${proto}://${lanIp()}:${port}`;
}

/** Installe n8n avec Docker sur la machine d'Odin (une fois). */
export async function installN8n(home: string, signal?: AbortSignal): Promise<string> {
  const miss = await ensureDocker(home, signal);
  if (miss) return miss;
  const dir = join(home, 'apps', 'n8n'); mkdirSync(dir, { recursive: true });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  writeFileSync(join(dir, 'compose.yaml'), composeFile(tz, lanIp()));
  const up = await dockerIn(dir, home, signal)(['compose', 'up', '-d']);
  if (!up.ok) return `Lancement de n8n impossible : ${up.err.slice(-400)}`;
  for (let k = 0; k < 30; k++) { if ((await n8nStatus({ url: 'http://127.0.0.1:5678' })).up) break; await new Promise((r) => setTimeout(r, 3000)); }
  return `✅ n8n est installé et lancé : http://${lanIp()}:5678 . Ouvre-le une fois pour créer ton compte, puis Paramètres → n8n API → « Create an API key », et donne la clé à Odin (Automatisations → Clé).`;
}

/** Une demande en français → workflow n8n vérifié et créé (désactivé). */
export async function createFromDescription(ctx: Pick<ToolContext, 'llm' | 'careCfg' | 'home'>, description: string): Promise<{ ok: boolean; text: string; id?: string }> {
  if (!ctx.llm) return { ok: false, text: 'Aucune IA disponible pour écrire le workflow.' };
  const c = n8nCfg(ctx.careCfg), home = ctx.home ?? join(homedir(), '.odin');
  let lastErr = '';
  for (let k = 0; k < 2; k++) {
    const out = await ctx.llm(workflowPrompt(odinUrlForN8n(ctx.careCfg), hookToken(home)), `${description}${lastErr ? `\n\n(Ton essai précédent était invalide : ${lastErr}. Corrige.)` : ''}`, 6000);
    let wf: { name: string; nodes: never; connections: Record<string, unknown>; explication?: string };
    try { wf = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { lastErr = 'JSON illisible'; continue; }
    const bad = checkWorkflow(wf);
    if (bad) { lastErr = bad; continue; }
    const made = await createWorkflow(c, { name: wf.name, nodes: wf.nodes, connections: wf.connections });
    return { ok: true, id: made.id, text: `✅ Automatisation « ${made.name} » créée (désactivée) : ${c.url.replace('127.0.0.1', lanIp())}/workflow/${made.id}\n${wf.explication ?? ''}\nTeste-la dans n8n (« Execute workflow »), puis dis « active-la ».` };
  }
  return { ok: false, text: `Je n'ai pas réussi à écrire un workflow valide (${lastErr}). Reformule, ou pars d'un modèle.` };
}

export const automationTool: Tool = {
  name: 'automatisation',
  description: 'Automatisations avec n8n (installé sur la machine d\'Odin, relié au Cerveau). « etat » : n8n prêt ? « installer » : installe n8n (Docker). « creer » : une demande en français → workflow n8n (déclencheur + étapes + appels à Odin/Cerveau), créé désactivé. « modele » : ajoute un modèle prêt (point-matin, taches-retard, rss, webhook-capture, surveille-site, cerveau-change). « lister », « activer », « desactiver », « executions » (dernières exécutions, échecs).',
  risk: 'exec',
  schema: obj({ action: { type: 'string', enum: ['etat', 'installer', 'creer', 'modele', 'lister', 'activer', 'desactiver', 'executions'] }, description: str('pour creer : ce que l\'automatisation doit faire'), id: str('identifiant du workflow (activer, desactiver, executions) ou du modèle') }, ['action']),
  summarize: (i) => `automatisation ${s(i.action)} ${s(i.description || i.id).slice(0, 100)}`,
  lookup: (i) => ['etat', 'lister', 'executions'].includes(s(i.action)),
  async run(i, ctx) {
    const c = n8nCfg(ctx.careCfg), home = ctx.home ?? join(homedir(), '.odin'), a = s(i.action);
    if (a === 'installer') return installN8n(home, ctx.signal);
    const st = await n8nStatus(c);
    if (a === 'etat') return !st.up ? `n8n ne répond pas à ${c.url}. Dis « installe n8n » et je m'en occupe.` : !st.keyOk ? `n8n tourne (${c.url}) mais Odin n'a pas encore sa clé API${st.error ? ` (${st.error})` : ''} : n8n → Paramètres → n8n API → Create an API key, puis Automatisations → Clé.` : `✓ n8n prêt (${c.url}) · ${st.workflows} automatisation(s).`;
    if (!st.up) return `n8n n'est pas installé ou ne répond pas (${c.url}). Action « installer » d'abord.`;
    if (!st.keyOk) return `n8n tourne mais il me faut sa clé API (Paramètres → n8n API dans n8n) ${st.error ? `: ${st.error}` : ''}.`;
    if (a === 'creer') return (await createFromDescription(ctx, s(i.description))).text;
    if (a === 'modele') {
      const t = templates(odinUrlForN8n(ctx.careCfg), hookToken(home)).find((x) => x.id === s(i.id));
      if (!t) return `Modèles : ${templates('', '').map((x) => `${x.id} (${x.name})`).join(', ')}.`;
      const made = await createWorkflow(c, t.wf);
      return `✅ Modèle « ${t.name} » ajouté (désactivé) : ${c.url.replace('127.0.0.1', lanIp())}/workflow/${made.id}. ${t.what}`;
    }
    if (a === 'lister') { const list = await listWorkflows(c); return list.length ? list.map((w) => `- ${w.active ? '🟢' : '⚪'} ${w.name} (id ${w.id})`).join('\n') : 'Aucune automatisation pour l\'instant.'; }
    if (a === 'activer' || a === 'desactiver') { const w = await setActive(c, s(i.id), a === 'activer'); return `${a === 'activer' ? '🟢 Activée' : '⚪ Désactivée'} : ${w.name}`; }
    if (a === 'executions') { const ex = await listExecutions(c, s(i.id) || undefined, 15); return ex.length ? ex.map((e) => `- ${e.startedAt?.slice(0, 16).replace('T', ' ')} · workflow ${e.workflowId} · ${e.status ?? (e.finished ? 'ok' : '…')}`).join('\n') : 'Aucune exécution.'; }
    return 'action inconnue';
  },
};
